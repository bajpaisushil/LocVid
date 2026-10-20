import { buildTimeline, frameCount } from '@/core/timeline'
import { Compositor } from '@/render/compositor'
import { fontUsages, loadFonts } from '@/render/fonts'
import { get2d, type CanvasFactory } from '@/render/types'
import { ExportSources } from './sources'
import { ExportError, type RenderJob } from './types'

/**
 * Render + encode a project to MP4 (H.264, plus AAC when `encodeAudio`) with
 * WebCodecs, using the very same Compositor as the preview. Frames are
 * rendered one at a time and handed to the hardware encoder; nothing is
 * accumulated except the compressed output. Runs in a worker (preferred) or
 * on the main thread with identical results.
 */

export interface PipelineEnv {
  createCanvas: CanvasFactory
  /** Global scope whose `fonts` set receives our FontFaces (`self` in a worker, `window` on the main thread). */
  fontScope: unknown
  allowElementFallback: boolean
}

export interface PipelineHooks {
  onProgress(frame: number, total: number): void
  isCancelled(): boolean
}

export interface PipelineResult {
  buffer: ArrayBuffer
  warnings: string[]
  videoCodec: string
  audioCodec: string | null
}

/** One second of audio per encoder call keeps memory flat. */
const AUDIO_CHUNK_SECONDS = 1

export async function runWebCodecsPipeline(job: RenderJob, env: PipelineEnv, hooks: PipelineHooks): Promise<PipelineResult> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioSampleSource, AudioSample, Quality } = await import('mediabunny')
  const { project, settings } = job
  const { width, height, fps } = settings
  const timeline = buildTimeline(project)
  const total = frameCount(timeline.duration, fps)
  if (total === 0) throw new ExportError('empty', 'There is nothing to export yet.')

  await loadFonts(fontUsages(project), env.fontScope)

  const canvas = env.createCanvas(width, height)
  const ctx = get2d(canvas)
  const compositor = new Compositor(env.createCanvas)
  const sources = new ExportSources({
    project,
    timeline,
    assets: job.assets,
    blobs: job.blobs,
    fps,
    width,
    height,
    allowElementFallback: env.allowElementFallback,
  })

  let videoCodec = 'avc'
  let audioCodec: string | null = null
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const video = new CanvasSource(canvas, {
    codec: 'avc',
    quality: new Quality({ bitrate: settings.videoBitrate }),
    keyFrameInterval: 2,
    latencyMode: 'quality',
    onEncoderConfig: (config) => {
      videoCodec = config.codec
    },
  })
  output.addVideoTrack(video, { frameRate: fps })

  const sampleRate = job.audio?.sampleRate ?? 48_000
  let audio: InstanceType<typeof AudioSampleSource> | null = null
  if (job.encodeAudio) {
    audio = new AudioSampleSource({
      codec: 'aac',
      quality: new Quality({ bitrate: settings.audioBitrate }),
      onEncoderConfig: (config) => {
        audioCodec = config.codec
      },
    })
    output.addAudioTrack(audio)
  }

  const audioFrames = Math.round((total / fps) * sampleRate)
  let audioCursor = 0
  /** Feed audio up to `untilFrame` (interleaved with video so the muxer never stalls). */
  const pumpAudio = async (untilFrame: number) => {
    if (!audio) return
    const chunk = AUDIO_CHUNK_SECONDS * sampleRate
    while (audioCursor < Math.min(untilFrame, audioFrames)) {
      const n = Math.min(chunk, audioFrames - audioCursor)
      const planar = new Float32Array(n * 2)
      const channels = job.audio?.channels ?? []
      if (channels.length) {
        for (let c = 0; c < 2; c++) {
          const src = channels[Math.min(c, channels.length - 1)]!
          planar.set(src.subarray(audioCursor, Math.min(src.length, audioCursor + n)), c * n)
        }
      }
      const sample = new AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: 2, sampleRate, timestamp: audioCursor / sampleRate })
      await audio.add(sample)
      sample.close()
      audioCursor += n
    }
  }

  try {
    await output.start()
    const input = { project, timeline, sources }
    for (let i = 0; i < total; i++) {
      if (hooks.isCancelled()) throw new ExportError('cancelled', 'Export cancelled.')
      const t = i / fps
      await sources.prepare(i, t)
      compositor.render(ctx, width, height, input, t)
      await video.add(t, 1 / fps)
      await pumpAudio(Math.round((t + 1) * sampleRate))
      if (i % 5 === 0 || i === total - 1) hooks.onProgress(i + 1, total)
    }
    await pumpAudio(audioFrames)
    video.close()
    audio?.close()
    await output.finalize()
    const buffer = output.target.buffer
    if (!buffer || buffer.byteLength === 0) throw new ExportError('codec', 'The encoder produced an empty file.')
    return { buffer, warnings: sources.warnings, videoCodec, audioCodec }
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined)
    throw error
  } finally {
    sources.dispose()
    compositor.dispose()
  }
}
