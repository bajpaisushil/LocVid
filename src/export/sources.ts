import { frameAt, frameCount, videoSourceTime, type Timeline, type TimelineEntry } from '@/core/timeline'
import type { AssetMeta, Project } from '@/core/types'
import type { FrameSources, SourceImage } from '@/render/types'
import type { DepthAnalysis } from '@/storage/db'
import { ExportError } from './types'

/**
 * Pixel sources for export. Unlike the preview (which plays <video> elements
 * in real time), export needs the exact frame for every output timestamp:
 * each video scene gets a reader that decodes its precomputed list of source
 * timestamps in order with WebCodecs (via mediabunny), one frame at a time.
 * Decoded images are kept within a memory budget and released when unused.
 */

interface VideoReader {
  /** Output frame index → position in `times`. */
  firstFrame: number
  times: number[]
  next(): Promise<SourceImage | null>
  current: SourceImage | null
  position: number
  dispose(): void
}

const IMAGE_BUDGET = 512 * 1024 * 1024

export interface ExportSourcesOptions {
  project: Project
  timeline: Timeline
  assets: Record<string, AssetMeta>
  blobs: Record<string, Blob>
  depths: Record<string, DepthAnalysis>
  fps: number
  width: number
  height: number
  /** Allow the <video>-seeking fallback (main thread only). */
  allowElementFallback: boolean
}

export class ExportSources implements FrameSources {
  private readonly opts: ExportSourcesOptions
  private images = new Map<string, { image: SourceImage; bytes: number; lastUsed: number }>()
  private readers = new Map<string, VideoReader>()
  private frameIndex = 0
  readonly warnings: string[] = []

  constructor(options: ExportSourcesOptions) {
    this.opts = options
  }

  // ---- FrameSources (synchronous; `prepare` has already loaded what's needed) ----

  image(assetId: string): SourceImage | null {
    const entry = this.images.get(assetId)
    if (!entry) return null
    entry.lastUsed = this.frameIndex
    return entry.image
  }

  videoFrame(sceneId: string): SourceImage | null {
    return this.readers.get(sceneId)?.current ?? null
  }

  videoDuration(assetId: string): number | undefined {
    const meta = this.opts.assets[assetId]
    return meta?.kind === 'video' ? meta.duration : undefined
  }

  depth(assetId: string): DepthAnalysis | null {
    return this.opts.depths[assetId] ?? null
  }

  // ---- Frame preparation ----

  /** Load everything frame `index` (time t) draws: images, the logo, decoded video frames. */
  async prepare(index: number, t: number): Promise<void> {
    this.frameIndex = index
    const { plan } = frameAt(this.opts.timeline, t)
    const entries = plan.kind === 'scene' ? [plan.entry] : plan.kind === 'transition' ? [plan.from, plan.to] : []
    const logo = this.opts.project.brand.logoAssetId
    if (logo && this.opts.assets[logo]) await this.ensureImage(logo)
    for (const entry of entries) {
      const bg = entry.scene.background
      if (bg.kind !== 'media') continue
      const meta = this.opts.assets[bg.assetId]
      if (!meta) throw new ExportError('missing-media', `Scene ${entry.index + 1} uses media that is missing from this browser.`)
      if (meta.kind === 'image') await this.ensureImage(bg.assetId)
      else if (meta.kind === 'video') await this.advanceVideo(entry, index)
    }
    this.releaseFinished(index)
  }

  private async ensureImage(assetId: string): Promise<void> {
    if (this.images.has(assetId)) return
    const blob = this.opts.blobs[assetId]
    if (!blob) throw new ExportError('missing-media', 'A picture used in this project is missing from local storage.')
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(blob)
      // Keep decode memory proportional to the output: 2× the long side is plenty for zoom/crop.
      const limit = Math.max(this.opts.width, this.opts.height) * 2
      if (Math.max(bitmap.width, bitmap.height) > limit) {
        const scale = limit / Math.max(bitmap.width, bitmap.height)
        const resized = await createImageBitmap(bitmap, {
          resizeWidth: Math.round(bitmap.width * scale),
          resizeHeight: Math.round(bitmap.height * scale),
          resizeQuality: 'high',
        })
        bitmap.close()
        bitmap = resized
      }
    } catch (error) {
      throw new ExportError('decode', `Could not decode “${this.opts.assets[assetId]?.name ?? 'an image'}”.`, undefined, { cause: error })
    }
    this.images.set(assetId, {
      image: { source: bitmap, width: bitmap.width, height: bitmap.height },
      bytes: bitmap.width * bitmap.height * 4,
      lastUsed: this.frameIndex,
    })
    this.evictImages()
  }

  private evictImages(): void {
    let total = 0
    for (const e of this.images.values()) total += e.bytes
    if (total <= IMAGE_BUDGET) return
    const logo = this.opts.project.brand.logoAssetId
    for (const [id, e] of [...this.images.entries()].toSorted((a, b) => a[1].lastUsed - b[1].lastUsed)) {
      if (total <= IMAGE_BUDGET * 0.75) break
      if (id === logo || e.lastUsed === this.frameIndex) continue
      ;(e.image.source as ImageBitmap).close()
      total -= e.bytes
      this.images.delete(id)
    }
  }

  /** Close readers and images for scenes that are completely finished. */
  private releaseFinished(index: number): void {
    const t = index / this.opts.fps
    for (const [sceneId, reader] of this.readers) {
      const entry = this.opts.timeline.entries.find((e) => e.scene.id === sceneId)
      if (!entry || t >= entry.visibleEnd) {
        reader.dispose()
        this.readers.delete(sceneId)
      }
    }
    // Images no longer referenced by any upcoming scene can be dropped.
    const upcoming = new Set<string>()
    for (const entry of this.opts.timeline.entries) {
      if (entry.visibleEnd > t && entry.scene.background.kind === 'media') upcoming.add(entry.scene.background.assetId)
    }
    const logo = this.opts.project.brand.logoAssetId
    if (logo) upcoming.add(logo)
    for (const [id, e] of this.images) {
      if (!upcoming.has(id)) {
        ;(e.image.source as ImageBitmap).close()
        this.images.delete(id)
      }
    }
  }

  private async advanceVideo(entry: TimelineEntry, index: number): Promise<void> {
    let reader = this.readers.get(entry.scene.id)
    if (!reader) {
      reader = await this.openReader(entry)
      this.readers.set(entry.scene.id, reader)
    }
    // Clamp: float rounding at a scene boundary must never leave the first frame undecoded.
    const target = Math.max(0, index - reader.firstFrame)
    while (reader.position < target) {
      const frame = await reader.next()
      reader.position++
      if (frame) reader.current = frame
    }
  }

  /** Output frames during which a scene is visible, and the clip time each one needs. */
  private sourceTimes(entry: TimelineEntry): { firstFrame: number; times: number[] } {
    const { fps } = this.opts
    const bg = entry.scene.background
    if (bg.kind !== 'media') return { firstFrame: 0, times: [] }
    const duration = this.videoDuration(bg.assetId)
    const total = frameCount(this.opts.timeline.duration, fps)
    const firstFrame = Math.max(0, Math.ceil(entry.visibleStart * fps - 1e-6))
    const lastFrame = Math.min(total - 1, Math.ceil(entry.visibleEnd * fps - 1e-6) - 1)
    const times: number[] = []
    for (let i = firstFrame; i <= lastFrame; i++) {
      times.push(videoSourceTime(entry, i / fps - entry.start, bg.trimStart, duration, bg.loop))
    }
    return { firstFrame, times }
  }

  private async openReader(entry: TimelineEntry): Promise<VideoReader> {
    const bg = entry.scene.background
    if (bg.kind !== 'media') throw new Error('not a video scene')
    const blob = this.opts.blobs[bg.assetId]
    const meta = this.opts.assets[bg.assetId]
    if (!blob || !meta) throw new ExportError('missing-media', `The video in scene ${entry.index + 1} is missing from local storage.`)
    const { firstFrame, times } = this.sourceTimes(entry)
    try {
      return await openDecoderReader(blob, times, firstFrame, Math.max(this.opts.width, this.opts.height) * 2)
    } catch (error) {
      if (!this.opts.allowElementFallback) throw error
      this.warnings.push(`“${meta.name}” was read frame-by-frame through the browser's video player (slower), because WebCodecs could not decode it.`)
      return openElementReader(blob, times, firstFrame)
    }
  }

  dispose(): void {
    for (const reader of this.readers.values()) reader.dispose()
    this.readers.clear()
    for (const e of this.images.values()) (e.image.source as ImageBitmap).close()
    this.images.clear()
  }
}

/** Decode exactly the requested timestamps, in order, with WebCodecs (mediabunny CanvasSink). */
async function openDecoderReader(blob: Blob, times: number[], firstFrame: number, maxSide: number): Promise<VideoReader> {
  const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny')
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const track = await input.getPrimaryVideoTrack()
  if (!track) {
    input.dispose()
    throw new ExportError('decode', 'The file has no video track.')
  }
  if (!(await track.canDecode())) {
    input.dispose()
    throw new ExportError('decode', 'This browser cannot decode the video codec with WebCodecs.')
  }
  const displayW = track.displayWidth
  const displayH = track.displayHeight
  const scale = Math.min(1, maxSide / Math.max(displayW, displayH))
  const sink = new CanvasSink(track, {
    width: Math.max(2, Math.round(displayW * scale)),
    height: Math.max(2, Math.round(displayH * scale)),
    fit: 'fill',
    poolSize: 3,
  })
  const iterator = sink.canvasesAtTimestamps(times)
  const reader: VideoReader = {
    firstFrame,
    times,
    current: null,
    position: -1,
    async next() {
      const result = await iterator.next()
      if (result.done || !result.value) return null
      const { canvas } = result.value
      return { source: canvas, width: canvas.width, height: canvas.height }
    },
    dispose() {
      void iterator.return(undefined)
      input.dispose()
    },
  }
  return reader
}

/** Fallback: seek a <video> element to each timestamp (main thread only, slower but universal). */
async function openElementReader(blob: Blob, times: number[], firstFrame: number): Promise<VideoReader> {
  if (typeof document === 'undefined') throw new ExportError('unsupported', 'Video decoding is not available in this context.')
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = url
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve()
    video.onerror = () => reject(new ExportError('decode', 'The browser could not open a video used in this project.'))
  })
  let i = 0
  return {
    firstFrame,
    times,
    current: null,
    position: -1,
    async next() {
      const t = times[i++]
      if (t === undefined) return null
      if (Math.abs(video.currentTime - t) > 1e-4) {
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
          video.currentTime = t
        })
      }
      return { source: video, width: video.videoWidth, height: video.videoHeight }
    },
    dispose() {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    },
  }
}
