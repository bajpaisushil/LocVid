import { DUCK_LEVEL, DUCK_RAMP, type AudioClip, type DuckWindow } from '@/core/audioPlan'

/** Piecewise-linear gain of a clip over timeline time: volume × fades × ducking. */
export type Envelope = [time: number, gain: number][]

function fadeGain(clip: AudioClip, t: number): number {
  const end = clip.start + clip.duration
  if (t <= clip.start || t >= end) return 0
  let g = 1
  if (clip.fadeIn > 0 && t < clip.start + clip.fadeIn) g = Math.min(g, (t - clip.start) / clip.fadeIn)
  if (clip.fadeOut > 0 && t > end - clip.fadeOut) g = Math.min(g, (end - t) / clip.fadeOut)
  return Math.max(0, g)
}

function duckGain(windows: readonly DuckWindow[], t: number): number {
  let g = 1
  for (const w of windows) {
    if (t < w.start - DUCK_RAMP || t > w.end + DUCK_RAMP) continue
    let d: number
    if (t < w.start) d = (w.start - t) / DUCK_RAMP
    else if (t > w.end) d = (t - w.end) / DUCK_RAMP
    else d = 0
    g = Math.min(g, DUCK_LEVEL + (1 - DUCK_LEVEL) * Math.min(1, d))
  }
  return g
}

export function clipEnvelope(clip: AudioClip, windows: readonly DuckWindow[]): Envelope {
  const end = clip.start + clip.duration
  const times = new Set<number>([clip.start, clip.start + clip.fadeIn, end - clip.fadeOut, end])
  if (clip.duck) {
    for (const w of windows) {
      for (const t of [w.start - DUCK_RAMP, w.start, w.end, w.end + DUCK_RAMP]) times.add(t)
    }
  }
  const sorted = [...times].filter((t) => t >= clip.start && t <= end).toSorted((a, b) => a - b)
  return sorted.map((t) => [t, clip.volume * fadeGain(clip, t) * (clip.duck ? duckGain(windows, t) : 1)])
}

/** Gain at time t by linear interpolation of an envelope. */
export function envelopeAt(envelope: Envelope, t: number): number {
  if (envelope.length === 0) return 0
  const first = envelope[0]!
  if (t <= first[0]) return first[1]
  for (let i = 1; i < envelope.length; i++) {
    const [t1, g1] = envelope[i]!
    const [t0, g0] = envelope[i - 1]!
    if (t <= t1) return t1 === t0 ? g1 : g0 + ((g1 - g0) * (t - t0)) / (t1 - t0)
  }
  return envelope[envelope.length - 1]![1]
}
