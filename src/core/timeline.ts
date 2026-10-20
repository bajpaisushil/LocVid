import { clamp, roundTo } from '@/lib/math'
import type { Project, Scene, TextOverlay, TransitionType } from './types'

/**
 * Timing model
 * ------------
 * Scenes are laid end to end: scene i occupies [start_i, start_i + duration_i)
 * and the project lasts exactly the sum of scene durations.
 *
 * A transition between scene i-1 and i is *centered on the cut*: for a
 * transition of length d, scene i-1 stays visible until cut + d/2 and scene i
 * becomes visible from cut - d/2. Transitions therefore never change the total
 * duration, which keeps the numbers users see simple ("3 × 5 s = 15 s").
 *
 * Each transition is capped at half of either neighbour's duration, so the two
 * transition windows of a scene can never overlap: at most two scenes are ever
 * visible at the same time.
 */

export interface TimelineEntry {
  scene: Scene
  index: number
  /** Nominal start/end on the project timeline (seconds). */
  start: number
  end: number
  /** Effective (clamped) length of the transition from the previous scene; 0 for none/first. */
  inDuration: number
  inType: TransitionType
  /** Effective length of the transition into the next scene. */
  outDuration: number
  /** Extended window during which the scene is drawn (includes transition halves). */
  visibleStart: number
  visibleEnd: number
}

export interface Timeline {
  entries: TimelineEntry[]
  duration: number
  /** Fade from black/white at the very start (first scene's transition), seconds. */
  fadeIn: number
  fadeInColor: 'black' | 'white'
  /** Fade to black at the very end, seconds. */
  fadeOut: number
}

export function effectiveTransition(prev: Scene | undefined, scene: Scene): number {
  if (!prev || scene.transition.type === 'none') return 0
  return roundTo(Math.max(0, Math.min(scene.transition.duration, prev.duration * 0.5, scene.duration * 0.5)), 4)
}

export function totalDuration(scenes: readonly Pick<Scene, 'duration'>[]): number {
  let total = 0
  for (const s of scenes) total += s.duration
  return roundTo(total, 4)
}

export function buildTimeline(project: Pick<Project, 'scenes' | 'fadeOutEnd'>): Timeline {
  const { scenes } = project
  const entries: TimelineEntry[] = []
  let cursor = 0
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!
    const next = scenes[i + 1]
    const inDuration = effectiveTransition(scenes[i - 1], scene)
    const outDuration = next ? effectiveTransition(scene, next) : 0
    const start = roundTo(cursor, 4)
    const end = roundTo(cursor + scene.duration, 4)
    entries.push({
      scene,
      index: i,
      start,
      end,
      inDuration,
      inType: i === 0 ? 'none' : scene.transition.type,
      outDuration,
      visibleStart: roundTo(start - inDuration / 2, 4),
      visibleEnd: roundTo(end + outDuration / 2, 4),
    })
    cursor = end
  }
  const duration = roundTo(cursor, 4)
  const first = scenes[0]
  const fadeIn =
    first && first.transition.type !== 'none' ? Math.min(first.transition.duration, first.duration * 0.5) : 0
  return {
    entries,
    duration,
    fadeIn,
    fadeInColor: first?.transition.type === 'fadeWhite' ? 'white' : 'black',
    fadeOut: Math.min(project.fadeOutEnd, duration * 0.5),
  }
}

/** Index of the scene whose nominal span contains t (clamped to the timeline). */
export function sceneIndexAt(timeline: Timeline, t: number): number {
  const { entries } = timeline
  if (entries.length === 0) return -1
  if (t <= 0) return 0
  let lo = 0
  let hi = entries.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (entries[mid]!.start <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export type FramePlan =
  | { kind: 'empty' }
  | { kind: 'scene'; entry: TimelineEntry; localTime: number }
  | {
      kind: 'transition'
      from: TimelineEntry
      to: TimelineEntry
      fromLocal: number
      toLocal: number
      /** 0 → fully "from", 1 → fully "to". */
      progress: number
      type: TransitionType
    }

export interface FrameState {
  plan: FramePlan
  /** Global fade overlay (project fade-in / fade-out). */
  fade: { color: 'black' | 'white'; alpha: number } | null
}

/** Describe what to draw at project time t. Pure function shared by preview and export. */
export function frameAt(timeline: Timeline, t: number): FrameState {
  const { entries, duration } = timeline
  if (entries.length === 0 || duration <= 0) return { plan: { kind: 'empty' }, fade: null }
  const time = clamp(t, 0, Math.max(0, duration - 1e-6))
  const index = sceneIndexAt(timeline, time)
  const entry = entries[index]!
  let plan: FramePlan = { kind: 'scene', entry, localTime: time - entry.start }

  const prev = entries[index - 1]
  const next = entries[index + 1]
  if (prev && entry.inDuration > 0 && time < entry.start + entry.inDuration / 2) {
    const windowStart = entry.start - entry.inDuration / 2
    plan = {
      kind: 'transition',
      from: prev,
      to: entry,
      fromLocal: time - prev.start,
      toLocal: time - entry.start,
      progress: clamp((time - windowStart) / entry.inDuration, 0, 1),
      type: entry.inType,
    }
  } else if (next && entry.outDuration > 0 && time >= entry.end - entry.outDuration / 2) {
    const windowStart = entry.end - entry.outDuration / 2
    plan = {
      kind: 'transition',
      from: entry,
      to: next,
      fromLocal: time - entry.start,
      toLocal: time - next.start,
      progress: clamp((time - windowStart) / entry.outDuration, 0, 1),
      type: next.inType,
    }
  }

  let fade: FrameState['fade'] = null
  if (timeline.fadeIn > 0 && time < timeline.fadeIn) {
    fade = { color: timeline.fadeInColor, alpha: 1 - time / timeline.fadeIn }
  }
  if (timeline.fadeOut > 0 && time > duration - timeline.fadeOut) {
    const alpha = clamp((time - (duration - timeline.fadeOut)) / timeline.fadeOut, 0, 1)
    if (!fade || alpha > fade.alpha) fade = { color: 'black', alpha }
  }
  return { plan, fade }
}

/** Length of time a scene is on screen, including transition halves. */
export function visibleDuration(entry: TimelineEntry): number {
  return entry.visibleEnd - entry.visibleStart
}

/** 0..1 progress of a scene's motion (zoom/pan), spanning its whole visible window. */
export function motionProgress(entry: TimelineEntry, localTime: number): number {
  const span = visibleDuration(entry)
  if (span <= 0) return 0
  return clamp((localTime + entry.inDuration / 2) / span, 0, 1)
}

/**
 * Source-clip time for a video background at a scene-local time. The clip starts
 * playing when the scene first becomes visible. Returns null if a non-looping clip
 * has ended (caller holds the last frame).
 */
export function videoSourceTime(
  entry: TimelineEntry,
  localTime: number,
  trimStart: number,
  clipDuration: number | undefined,
  loop: boolean,
): number {
  const elapsed = Math.max(0, localTime + entry.inDuration / 2)
  const t = trimStart + elapsed
  if (!clipDuration || clipDuration <= 0) return t
  if (t < clipDuration) return t
  if (!loop) return Math.max(0, clipDuration - 0.001)
  const loopSpan = clipDuration - Math.min(trimStart, clipDuration - 0.05)
  return trimStart + ((t - trimStart) % Math.max(0.05, loopSpan))
}

/** Number of frames an export at `fps` produces. */
export function frameCount(duration: number, fps: number): number {
  return Math.max(0, Math.round(duration * fps))
}

export interface OverlayTiming {
  /** Scene-local time the overlay becomes visible (may be negative during an in-transition). */
  start: number
  end: number
  /** Seconds used by the in/out animation. */
  animIn: number
  animOut: number
}

/** When a text overlay is on screen, in scene-local time. */
export function overlayTiming(overlay: TextOverlay, entry: TimelineEntry): OverlayTiming {
  const duration = entry.scene.duration
  const start =
    overlay.start <= 0 && overlay.animationIn === 'none' ? -entry.inDuration / 2 : Math.min(overlay.start, duration)
  const end = overlay.end === null ? duration + entry.outDuration / 2 : Math.min(overlay.end, duration + entry.outDuration / 2)
  const span = Math.max(0, end - Math.max(start, 0))
  const anim = Math.min(0.5, span / 3)
  return {
    start,
    end,
    animIn: overlay.animationIn === 'none' ? 0 : anim,
    animOut: overlay.animationOut === 'none' ? 0 : anim,
  }
}
