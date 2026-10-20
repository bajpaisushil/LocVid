import { buildAudioPlan, planAssetIds } from '@/core/audioPlan'
import type { Timeline } from '@/core/timeline'
import type { AssetMeta, Project } from '@/core/types'
import { createMasterBus, scheduleClips } from '@/audio/schedule'
import { ExportError } from './types'

export const EXPORT_SAMPLE_RATE = 48_000

/** Above this size, decode clip audio by streaming the track instead of loading the whole file. */
const WHOLE_FILE_DECODE_LIMIT = 400 * 1024 * 1024

export interface MixResult {
  channels: Float32Array[]
  sampleRate: number
  warnings: string[]
}

/**
 * Render the project's audio plan (music, narration, voice-overs and clip
 * audio) into one stereo buffer with an OfflineAudioContext — the same
 * scheduling code the preview uses in real time. Returns null when the
 * project has no audio (the encoder then writes a silent track).
 */
export async function mixProjectAudio(
  project: Project,
  assets: Record<string, AssetMeta>,
  blobs: Record<string, Blob>,
  timeline: Timeline,
  duration: number,
  signal: AbortSignal,
  onProgress?: (fraction: number, detail: string) => void,
): Promise<MixResult | null> {
  const plan = buildAudioPlan(project, assets, timeline, { includeVideoAudio: true })
  if (plan.length === 0) return null
  if (typeof OfflineAudioContext === 'undefined') {
    throw new ExportError('unsupported', 'This browser cannot mix audio offline (Web Audio OfflineAudioContext is missing).')
  }
  const warnings: string[] = []
  const buffers = new Map<string, AudioBuffer>()
  const ids = planAssetIds(plan)
  for (let i = 0; i < ids.length; i++) {
    if (signal.aborted) throw new ExportError('cancelled', 'Export cancelled.')
    const id = ids[i]!
    const meta = assets[id]
    onProgress?.(i / (ids.length + 1), `Decoding audio: ${meta?.name ?? id}`)
    const blob = blobs[id]
    if (!blob || !meta) {
      warnings.push(`Audio “${meta?.name ?? id}” is missing and was skipped.`)
      continue
    }
    try {
      buffers.set(id, await decodeForMix(blob, meta, plan.filter((c) => c.assetId === id)))
    } catch (error) {
      if (error instanceof ExportError && error.code === 'cancelled') throw error
      warnings.push(`Audio from “${meta.name}” could not be decoded and was left out.`)
      console.warn('Audio decode failed', meta.name, error)
    }
  }
  if (buffers.size === 0) return { channels: [], sampleRate: EXPORT_SAMPLE_RATE, warnings }

  onProgress?.(ids.length / (ids.length + 1), 'Mixing audio')
  const length = Math.max(1, Math.round(duration * EXPORT_SAMPLE_RATE))
  let rendered: AudioBuffer
  try {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: EXPORT_SAMPLE_RATE })
    scheduleClips(ctx, plan, buffers, { fromTime: 0, ctxTime: 0, destination: createMasterBus(ctx) })
    rendered = await ctx.startRendering()
  } catch (error) {
    throw new ExportError('memory', 'Mixing the audio failed — the browser may be low on memory.', 'Try shortening the video or using shorter audio files.', {
      cause: error,
    })
  }
  const channels = [0, 1].map((c) => {
    const data = new Float32Array(rendered.length)
    rendered.copyFromChannel(data, Math.min(c, rendered.numberOfChannels - 1))
    return data
  })
  return { channels, sampleRate: EXPORT_SAMPLE_RATE, warnings }
}

async function decodeForMix(blob: Blob, meta: AssetMeta, clips: { offset: number; duration: number; loop: boolean }[]): Promise<AudioBuffer> {
  if (blob.size <= WHOLE_FILE_DECODE_LIMIT) {
    const ctx = new OfflineAudioContext(2, 1, EXPORT_SAMPLE_RATE)
    return ctx.decodeAudioData(await blob.arrayBuffer())
  }
  // Very large (video) files: stream-decode only up to the furthest point the plan needs.
  const until = Math.max(...clips.map((c) => (c.loop ? (meta.duration ?? 0) : c.offset + c.duration))) + 0.5
  return streamDecode(blob, until)
}

async function streamDecode(blob: Blob, until: number): Promise<AudioBuffer> {
  const { Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await import('mediabunny')
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) throw new Error('No decodable audio track')
    const chunks: AudioBuffer[] = []
    for await (const { buffer } of new AudioBufferSink(track).buffers(0, until)) chunks.push(buffer)
    if (chunks.length === 0) throw new Error('No audio decoded')
    const rate = chunks[0]!.sampleRate
    const channels = Math.min(2, chunks[0]!.numberOfChannels)
    const total = chunks.reduce((n, b) => n + b.length, 0)
    // Assemble at the source rate, then let an OfflineAudioContext resample to 48 kHz.
    const assembleCtx = new OfflineAudioContext(channels, Math.max(1, Math.ceil((total / rate) * EXPORT_SAMPLE_RATE)), EXPORT_SAMPLE_RATE)
    const joined = assembleCtx.createBuffer(channels, total, rate)
    let offset = 0
    for (const chunk of chunks) {
      for (let c = 0; c < channels; c++) joined.copyToChannel(chunk.getChannelData(Math.min(c, chunk.numberOfChannels - 1)), c, offset)
      offset += chunk.length
    }
    if (rate === EXPORT_SAMPLE_RATE) return joined
    const source = assembleCtx.createBufferSource()
    source.buffer = joined
    source.connect(assembleCtx.destination)
    source.start()
    return await assembleCtx.startRendering()
  } finally {
    input.dispose()
  }
}
