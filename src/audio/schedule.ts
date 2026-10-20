import { duckWindows, type AudioClip } from '@/core/audioPlan'
import { clipEnvelope, envelopeAt } from './envelope'

export interface ScheduleOptions {
  /** Timeline time corresponding to `ctxTime`. */
  fromTime: number
  /** AudioContext time at which `fromTime` plays. */
  ctxTime: number
  destination: AudioNode
}

/**
 * Schedule audio clips on any BaseAudioContext — a live AudioContext for the
 * preview or an OfflineAudioContext for the export mixdown. Clips without a
 * decoded buffer are skipped. Returns the started nodes so callers can stop them.
 */
export function scheduleClips(
  ctx: BaseAudioContext,
  clips: readonly AudioClip[],
  buffers: ReadonlyMap<string, AudioBuffer>,
  { fromTime, ctxTime, destination }: ScheduleOptions,
): AudioBufferSourceNode[] {
  const windows = duckWindows(clips)
  const nodes: AudioBufferSourceNode[] = []
  const toCtx = (t: number) => ctxTime + (t - fromTime)

  for (const clip of clips) {
    const buffer = buffers.get(clip.assetId)
    if (!buffer) continue
    const clipEnd = clip.start + clip.duration
    if (clipEnd <= fromTime + 0.005) continue

    const startAt = Math.max(clip.start, fromTime)
    const elapsed = startAt - clip.start
    const loopLength = Math.max(0.05, buffer.duration - clip.offset)
    let sourceOffset = clip.offset + elapsed
    if (clip.loop) sourceOffset = clip.offset + (elapsed % loopLength)
    if (!clip.loop && sourceOffset >= buffer.duration) continue
    const remaining = clipEnd - startAt

    const source = ctx.createBufferSource()
    source.buffer = buffer
    if (clip.loop) {
      source.loop = true
      source.loopStart = clip.offset
      source.loopEnd = buffer.duration
    }
    const gain = ctx.createGain()
    const envelope = clipEnvelope(clip, windows)
    gain.gain.setValueAtTime(envelopeAt(envelope, startAt), toCtx(startAt))
    for (const [t, g] of envelope) {
      if (t > startAt) gain.gain.linearRampToValueAtTime(g, toCtx(t))
    }
    source.connect(gain).connect(destination)
    const when = toCtx(startAt)
    if (clip.loop) {
      source.start(when, sourceOffset)
      source.stop(when + remaining)
    } else {
      source.start(when, sourceOffset, Math.min(remaining, buffer.duration - sourceOffset))
    }
    nodes.push(source)
  }
  return nodes
}

/**
 * Master bus shared by preview and export: a gain stage into a fast limiter
 * that only engages near 0 dBFS, so stacked music + voice doesn't clip.
 */
export function createMasterBus(ctx: BaseAudioContext): GainNode {
  const input = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.12
  input.connect(limiter).connect(ctx.destination)
  return input
}
