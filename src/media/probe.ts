import { extensionOf, MediaImportError } from './detect'

/**
 * Browser-side probing: confirms the browser can actually decode a file,
 * reads its dimensions/duration and renders a thumbnail. Main thread only
 * (uses <video>, <img> and Web Audio).
 */

export interface ProbeResult {
  width?: number
  height?: number
  duration?: number
  hasAudio?: boolean
  thumbnail: Blob | null
  /** The blob to store. Usually the original file; a resized copy for oversized photos. */
  stored: Blob
  original?: { width: number; height: number; size: number }
}

/** Longest side we keep for photos: plenty for 1080p output with zoom, and bounded decode memory. */
export const MAX_IMAGE_SIDE = 4096
const THUMB_SIZE = 320

function withTimeout<T>(promise: Promise<T>, ms: number, message: string, fileName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MediaImportError(message, fileName)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding failed'))), type, quality)
  })
}

function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function thumbnailFrom(source: CanvasImageSource, width: number, height: number, alpha: boolean): Promise<Blob> {
  const size = fitWithin(width, height, THUMB_SIZE)
  const canvas = makeCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, size.width, size.height)
  return alpha ? canvasToBlob(canvas, 'image/png') : canvasToBlob(canvas, 'image/jpeg', 0.82)
}

/** SVGs can't be decoded in workers, so rasterize them once on import. */
async function rasterizeSvg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await withTimeout(img.decode(), 10_000, 'The SVG could not be rendered.', file.name)
    const natural = { width: img.naturalWidth || 1024, height: img.naturalHeight || 1024 }
    const target = fitWithin(natural.width, natural.height, 2048)
    // Upscale small vector logos so they stay crisp in a 1080p export.
    const scale = Math.max(1, 1024 / Math.max(target.width, target.height))
    const canvas = makeCanvas(target.width * scale, target.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await canvasToBlob(canvas, 'image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function probeImage(file: File): Promise<ProbeResult> {
  const ext = extensionOf(file.name)
  const isSvg = file.type === 'image/svg+xml' || ext === 'svg'
  const source: Blob = isSvg ? await rasterizeSvg(file) : file
  let bitmap: ImageBitmap
  try {
    bitmap = await withTimeout(createImageBitmap(source), 20_000, 'Decoding the image timed out.', file.name)
  } catch (error) {
    if (error instanceof MediaImportError) throw error
    const heic = ['heic', 'heif'].includes(ext) || /hei[cf]/i.test(file.type)
    throw new MediaImportError(
      heic
        ? 'This browser cannot decode HEIC photos. Convert it to JPEG first (e.g. export from Photos), or use Safari.'
        : 'This image could not be decoded. The file may be damaged or in a format this browser does not support.',
      file.name,
    )
  }
  try {
    const { width, height } = bitmap
    const alpha = !['jpg', 'jpeg'].includes(ext) && file.type !== 'image/jpeg'
    const thumbnail = await thumbnailFrom(bitmap, width, height, alpha)
    if (Math.max(width, height) <= MAX_IMAGE_SIDE) {
      return { width, height, thumbnail, stored: source }
    }
    // Oversized photo: store a high-quality downscaled copy.
    const target = fitWithin(width, height, MAX_IMAGE_SIDE)
    const canvas = makeCanvas(target.width, target.height)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, target.width, target.height)
    const stored = alpha ? await canvasToBlob(canvas, 'image/png') : await canvasToBlob(canvas, 'image/jpeg', 0.92)
    return {
      width: target.width,
      height: target.height,
      thumbnail,
      stored,
      original: { width, height, size: file.size },
    }
  } finally {
    bitmap.close()
  }
}

function waitFor(target: EventTarget, event: string, errorEvent = 'error'): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new Error(`${errorEvent} while waiting for ${event}`))
    }
    const cleanup = () => {
      target.removeEventListener(event, ok)
      target.removeEventListener(errorEvent, fail)
    }
    target.addEventListener(event, ok, { once: true })
    target.addEventListener(errorEvent, fail, { once: true })
  })
}

/** Ask mediabunny (container parser) for an exact duration and whether there's an audio track. */
async function inspectContainer(file: File): Promise<{ duration?: number; hasAudio?: boolean }> {
  try {
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny')
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    try {
      const audio = await input.getPrimaryAudioTrack()
      const duration = await input.computeDuration()
      return { duration: Number.isFinite(duration) && duration > 0 ? duration : undefined, hasAudio: audio !== null }
    } finally {
      input.dispose()
    }
  } catch {
    return {}
  }
}

export async function probeVideo(file: File): Promise<ProbeResult> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  try {
    video.src = url
    try {
      await withTimeout(waitFor(video, 'loadeddata'), 20_000, 'Reading the video timed out.', file.name)
    } catch (error) {
      if (error instanceof MediaImportError) throw error
      throw new MediaImportError(
        'This browser cannot play this video (unsupported codec or damaged file). MP4 (H.264) and WebM are the most compatible.',
        file.name,
      )
    }
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) {
      throw new MediaImportError('This file has no video track. Import it as audio instead.', file.name)
    }
    const container = await inspectContainer(file)
    const elementDuration = Number.isFinite(video.duration) ? video.duration : undefined
    const duration = container.duration ?? elementDuration
    if (!duration) throw new MediaImportError('Could not determine the video length.', file.name)

    video.currentTime = Math.min(1, duration * 0.1)
    await withTimeout(waitFor(video, 'seeked'), 10_000, 'Reading a video frame timed out.', file.name)
    const thumbnail = await thumbnailFrom(video, width, height, false)
    return { width, height, duration, hasAudio: container.hasAudio ?? true, thumbnail, stored: file }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/** Larger audio files skip the waveform (decoding would hold the whole file in memory). */
const WAVEFORM_MAX_BYTES = 80 * 1024 * 1024

export async function probeAudio(file: File): Promise<ProbeResult> {
  if (file.size <= WAVEFORM_MAX_BYTES && typeof OfflineAudioContext !== 'undefined') {
    let buffer: AudioBuffer
    try {
      const ctx = new OfflineAudioContext(1, 1, 22050)
      buffer = await withTimeout(
        ctx.decodeAudioData(await file.arrayBuffer()),
        30_000,
        'Decoding the audio timed out.',
        file.name,
      )
    } catch (error) {
      if (error instanceof MediaImportError) throw error
      throw new MediaImportError('This browser cannot decode this audio file (unsupported format or damaged file).', file.name)
    }
    return { duration: buffer.duration, thumbnail: await drawWaveform(buffer), stored: file }
  }
  // Large file: read duration from metadata only.
  const url = URL.createObjectURL(file)
  const audio = new Audio()
  audio.preload = 'metadata'
  try {
    audio.src = url
    await withTimeout(waitFor(audio, 'loadedmetadata'), 20_000, 'Reading the audio timed out.', file.name).catch(() => {
      throw new MediaImportError('This browser cannot play this audio file.', file.name)
    })
    if (!Number.isFinite(audio.duration)) throw new MediaImportError('Could not determine the audio length.', file.name)
    return { duration: audio.duration, thumbnail: null, stored: file }
  } finally {
    audio.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
}

/** Render a compact waveform image (used in the media bin and on the timeline). */
export async function drawWaveform(buffer: AudioBuffer, width = 480, height = 96): Promise<Blob> {
  const data = buffer.getChannelData(0)
  const bars = 120
  const step = Math.max(1, Math.floor(data.length / bars))
  const peaks: number[] = []
  let max = 0
  for (let i = 0; i < bars; i++) {
    let peak = 0
    const start = i * step
    const end = Math.min(data.length, start + step)
    for (let j = start; j < end; j += 8) peak = Math.max(peak, Math.abs(data[j]!))
    peaks.push(peak)
    max = Math.max(max, peak)
  }
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const barWidth = width / bars
  ctx.fillStyle = '#34d399'
  peaks.forEach((p, i) => {
    const h = Math.max(2, (max > 0 ? p / max : 0) * (height - 8))
    ctx.fillRect(i * barWidth + 1, (height - h) / 2, Math.max(1, barWidth - 2), h)
  })
  return canvasToBlob(canvas, 'image/png')
}
