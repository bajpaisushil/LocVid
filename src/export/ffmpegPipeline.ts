import { encodeWav } from '@/audio/wav'
import { buildTimeline, frameCount } from '@/core/timeline'
import { Compositor } from '@/render/compositor'
import { fontUsages, loadFonts } from '@/render/fonts'
import { get2d, type AnyCanvas } from '@/render/types'
import { loadFFmpeg, removeFiles, runFFmpeg } from './ffmpeg'
import { ExportSources } from './sources'
import { ExportError, type ExportStage, type RenderJob } from './types'

/**
 * Compatibility engine: frames are rendered by the same Compositor, written
 * as JPEGs into FFmpeg's in-memory file system a couple of seconds at a time,
 * encoded with libx264 into raw H.264 segments, and finally concatenated and
 * muxed with AAC audio into an MP4. Only one chunk of frames exists at once.
 */

export interface FFmpegHooks {
  onProgress(stage: ExportStage, fraction: number, frame?: number, total?: number): void
  isCancelled(): boolean
}

function canvasFor(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

async function toJpeg(canvas: AnyCanvas): Promise<Uint8Array> {
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
      : await new Promise<Blob>((resolve, reject) =>
          (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', 0.92),
        )
  return new Uint8Array(await blob.arrayBuffer())
}

/** Audio input arguments: the mixed WAV, or generated silence so every export has an AAC track. */
async function writeAudioInput(ffmpeg: Awaited<ReturnType<typeof loadFFmpeg>>, job: RenderJob, duration: number): Promise<string[]> {
  if (job.audio && job.audio.channels.length) {
    const wav = encodeWav(job.audio.channels, job.audio.sampleRate)
    await ffmpeg.writeFile('audio.wav', new Uint8Array(await wav.arrayBuffer()))
    return ['-i', 'audio.wav']
  }
  return ['-f', 'lavfi', '-t', duration.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']
}

export async function runFFmpegPipeline(job: RenderJob, hooks: FFmpegHooks): Promise<{ blob: Blob; warnings: string[] }> {
  const { project, settings } = job
  const { width, height, fps } = settings
  const timeline = buildTimeline(project)
  const total = frameCount(timeline.duration, fps)
  if (total === 0) throw new ExportError('empty', 'There is nothing to export yet.')

  const ffmpeg = await loadFFmpeg((p) => hooks.onProgress('loading-ffmpeg', p))
  await loadFonts(fontUsages(project))

  const canvas = canvasFor(width, height)
  const ctx = get2d(canvas)
  const compositor = new Compositor(canvasFor)
  const sources = new ExportSources({
    project,
    timeline,
    assets: job.assets,
    blobs: job.blobs,
    fps,
    width,
    height,
    allowElementFallback: true,
  })
  const chunkSize = Math.max(1, Math.round(fps * 2))
  const segments: string[] = []
  const created: string[] = []
  const kbps = Math.round(settings.videoBitrate / 1000)

  try {
    for (let start = 0; start < total; start += chunkSize) {
      const n = Math.min(chunkSize, total - start)
      const frames: string[] = []
      for (let j = 0; j < n; j++) {
        if (hooks.isCancelled()) throw new ExportError('cancelled', 'Export cancelled.')
        const i = start + j
        const t = i / fps
        await sources.prepare(i, t)
        compositor.render(ctx, width, height, { project, timeline, sources }, t)
        const name = `f${String(j).padStart(4, '0')}.jpg`
        await ffmpeg.writeFile(name, await toJpeg(canvas))
        frames.push(name)
        if (j % 3 === 0) hooks.onProgress('video', (i + 1) / total, i + 1, total)
        // Let the page breathe (progress paint, cancel clicks).
        if (j % 6 === 0) await new Promise((r) => setTimeout(r, 0))
      }
      const segment = `seg${String(segments.length).padStart(4, '0')}.h264`
      await runFFmpeg(ffmpeg, [
        '-framerate', String(fps),
        '-i', 'f%04d.jpg',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-maxrate', `${kbps}k`,
        '-bufsize', `${kbps * 2}k`,
        '-pix_fmt', 'yuv420p',
        '-bf', '0',
        '-g', String(chunkSize),
        '-f', 'h264',
        segment,
      ])
      await removeFiles(ffmpeg, frames)
      segments.push(segment)
      created.push(segment)
      hooks.onProgress('video', (start + n) / total, start + n, total)
    }

    hooks.onProgress('finalizing', 0)
    const duration = total / fps
    const audioArgs = await writeAudioInput(ffmpeg, job, duration)
    if (audioArgs.includes('audio.wav')) created.push('audio.wav')
    created.push('out.mp4')
    await runFFmpeg(
      ffmpeg,
      [
        '-fflags', '+genpts',
        '-f', 'h264',
        '-framerate', String(fps),
        '-i', `concat:${segments.join('|')}`,
        ...audioArgs,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', `${Math.round(settings.audioBitrate / 1000)}k`,
        '-ar', '48000',
        '-movflags', '+faststart',
        'out.mp4',
      ],
      (p) => hooks.onProgress('finalizing', p),
    )
    const data = await ffmpeg.readFile('out.mp4')
    if (typeof data === 'string' || data.byteLength === 0) throw new ExportError('ffmpeg', 'FFmpeg produced an empty file.')
    return { blob: new Blob([data as BlobPart], { type: 'video/mp4' }), warnings: sources.warnings }
  } finally {
    sources.dispose()
    compositor.dispose()
    await removeFiles(ffmpeg, created).catch(() => undefined)
  }
}

/**
 * Add an AAC track to a video-only MP4 produced by WebCodecs (for browsers
 * that can encode H.264 but not AAC, e.g. Firefox). Video is copied, not re-encoded.
 */
export async function muxAacWithFFmpeg(
  videoOnly: Blob,
  job: RenderJob,
  duration: number,
  onProgress: (stage: ExportStage, fraction: number) => void,
): Promise<Blob> {
  const ffmpeg = await loadFFmpeg((p) => onProgress('loading-ffmpeg', p))
  onProgress('finalizing', 0)
  await ffmpeg.writeFile('video.mp4', new Uint8Array(await videoOnly.arrayBuffer()))
  const audioArgs = await writeAudioInput(ffmpeg, job, duration)
  try {
    await runFFmpeg(
      ffmpeg,
      [
        '-i', 'video.mp4',
        ...audioArgs,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', `${Math.round(job.settings.audioBitrate / 1000)}k`,
        '-ar', '48000',
        '-movflags', '+faststart',
        'out.mp4',
      ],
      (p) => onProgress('finalizing', p),
    )
    const data = await ffmpeg.readFile('out.mp4')
    if (typeof data === 'string' || data.byteLength === 0) throw new ExportError('ffmpeg', 'FFmpeg produced an empty file.')
    return new Blob([data as BlobPart], { type: 'video/mp4' })
  } finally {
    await removeFiles(ffmpeg, ['video.mp4', 'audio.wav', 'out.mp4'])
  }
}
