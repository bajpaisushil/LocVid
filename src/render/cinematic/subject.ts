import type { SubjectAction } from '@/core/types'
import { clamp } from '@/lib/math'
import { ease } from '../easing'

/**
 * Whole-body animation of a cut-out subject ("actor") as a pure function of
 * time, so preview and export agree frame for frame. Everything is relative
 * to the actor's ground-contact point and measured in actor heights, so the
 * same action reads the same on a small child or a big close-up.
 *
 * The renderer applies, to each point p of the actor (relative to its anchor,
 * h = height above the ground in actor heights):
 *     p.x += bend · h² · H                     (a curved lean, feet stay planted)
 *     p   = rotate(scale(p, sx, sy), rotation) (about the anchor)
 *     p  += (tx, ty) · H
 */
export interface ActorPose {
  tx: number
  ty: number
  rotation: number
  sx: number
  sy: number
  bend: number
  /** Extra disparity (the actor comes closer). */
  depth: number
  /** 1 = feet on the ground, 0 = high in the air (drives the contact shadow). */
  contact: number
}

export interface PoseInput {
  action: SubjectAction
  /** 0..1 */
  amount: number
  /** +1 faces/travels right, −1 left. */
  direction: 1 | -1
  /** Seconds since the shot became visible. */
  time: number
  /** Shot length in seconds. */
  duration: number
  /** Per-actor offset (0..1) so several actors don't move in lockstep. */
  phase: number
  /** Edges of the picture the actor is cut off by. */
  edges: { left: boolean; right: boolean; top: boolean; bottom: boolean }
  /** How far (actor heights) the actor may travel in its direction before leaving the frame. */
  room?: number
}

export const REST_POSE: ActorPose = { tx: 0, ty: 0, rotation: 0, sx: 1, sy: 1, bend: 0, depth: 0, contact: 1 }

const TAU = Math.PI * 2
const smooth = (a: number, b: number, x: number) => ease.smooth(clamp((x - a) / (b - a), 0, 1))
const frac = (x: number) => x - Math.floor(x)

/** When the kick connects, in seconds into the shot (the ball prop launches here). */
export function kickTime(duration: number): number {
  return Math.max(0.6, duration * 0.44)
}

function breathe(k: number, t: number, phase: number): ActorPose {
  const p = phase * TAU
  return {
    ...REST_POSE,
    sy: 1 + 0.014 * k * Math.sin((TAU * t) / 3.4 + p),
    sx: 1 - 0.005 * k * Math.sin((TAU * t) / 3.4 + p),
    rotation: 0.008 * k * Math.sin((TAU * t) / 5.3 + p),
    bend: 0.008 * k * Math.sin((TAU * t) / 4.1 + p),
  }
}

/** Distance travelled (actor heights) at speed `v` that eases in and caps at `max`. */
function travel(t: number, v: number, max: number): number {
  const ramp = 0.35
  const d = t < ramp ? (v * t * t) / (2 * ramp) : v * (t - ramp / 2)
  return Math.min(max, d)
}

function rawPose(input: PoseInput): ActorPose {
  const { action, direction: dir, time: t, duration: D, phase } = input
  const k = clamp(input.amount, 0, 1)
  const p = phase * TAU
  switch (action) {
    case 'none':
      return REST_POSE
    case 'breathe':
      return breathe(k, t, phase)
    case 'sway': {
      const s = Math.sin((TAU * t) / 2.6 + p)
      return {
        ...REST_POSE,
        rotation: 0.05 * k * s,
        bend: -0.035 * k * Math.sin((TAU * t) / 2.6 + p - 0.9),
        sy: 1 + 0.01 * k * Math.sin((2 * TAU * t) / 2.6 + p),
      }
    }
    case 'walk':
    case 'run': {
      const run = action === 'run'
      const step = run ? 0.36 : 0.58
      const u = t / step + phase
      const bump = Math.abs(Math.sin(Math.PI * u))
      const bob = (run ? 0.06 : 0.028) * k * bump
      // Cover the room the frame leaves over the whole shot, rather than dashing out of view.
      const reach = Math.min(run ? 2 : 1.2, Math.max(0, input.room ?? Infinity))
      const speed = Math.min(run ? 0.25 + 0.35 * k : 0.08 + 0.12 * k, reach / Math.max(0.5, D - 0.4))
      return {
        ...REST_POSE,
        tx: dir * travel(t, speed, reach),
        ty: -bob,
        rotation: (run ? 0.03 : 0.025) * k * Math.sin(Math.PI * u),
        bend: dir * (run ? 0.09 : 0.03) * k + (run ? 0.015 : 0.01) * k * Math.sin(TAU * u),
        sy: 1 - (run ? 0.04 : 0.015) * k * (1 - bump) + (run ? 0.02 : 0) * k * bump,
        sx: 1 + (run ? 0.02 : 0.008) * k * (1 - bump),
        contact: 1 - bump * (run ? 0.5 : 0.2),
      }
    }
    case 'jump': {
      const cycle = 1.3
      const u = frac(t / cycle + phase)
      const hmax = 0.05 + 0.13 * k
      let sy = 1
      let height = 0
      if (u < 0.18) sy = 1 - 0.12 * k * smooth(0, 0.18, u)
      else if (u < 0.26) sy = 1 - 0.12 * k + 0.2 * k * smooth(0.18, 0.26, u)
      else if (u < 0.74) {
        const a = (u - 0.26) / 0.48
        height = 4 * hmax * a * (1 - a)
        sy = 1 + 0.08 * k * (1 - smooth(0.26, 0.5, u))
      } else if (u < 0.84) sy = 1 - 0.14 * k * Math.sin(Math.PI * ((u - 0.74) / 0.1))
      return {
        ...REST_POSE,
        ty: -height,
        sy,
        sx: 1 + (1 - sy) * 0.5,
        rotation: 0.03 * k * Math.sin(TAU * u) * dir,
        contact: 1 - height / hmax,
      }
    }
    case 'dance': {
      const beat = 0.5
      const u = t / beat + phase * 2
      const bump = Math.abs(Math.sin(Math.PI * u))
      return {
        ...REST_POSE,
        tx: 0.06 * k * Math.sin((Math.PI * u) / 4),
        ty: -0.035 * k * bump,
        rotation: 0.07 * k * Math.sin(Math.PI * u * 0.5 + p),
        bend: 0.05 * k * Math.sin(Math.PI * u * 0.5 + p + 0.8),
        sy: 1 - 0.025 * k * (1 - bump),
        sx: 1 + 0.012 * k * (1 - bump),
        contact: 1 - bump * 0.3,
      }
    }
    case 'kick': {
      // Wind-up → strike → follow-through, around kickTime; breathing before and after.
      const hit = kickTime(D)
      const base = breathe(k * 0.6, t, phase)
      const windup = smooth(hit - 0.55, hit - 0.08, t) * (1 - smooth(hit - 0.08, hit, t))
      const strike = smooth(hit - 0.08, hit + 0.04, t) * (1 - smooth(hit + 0.15, hit + 0.75, t))
      return {
        ...base,
        rotation: base.rotation + dir * k * (-0.09 * windup + 0.13 * strike),
        bend: base.bend + dir * k * (-0.04 * windup + 0.06 * strike),
        tx: dir * k * 0.05 * smooth(hit - 0.08, hit + 0.1, t),
        sy: base.sy - 0.05 * k * windup + 0.03 * k * strike,
      }
    }
    case 'approach': {
      const s = ease.easeInOut(clamp(t / Math.max(0.5, D), 0, 1))
      const bump = Math.abs(Math.sin((Math.PI * t) / 0.6 + p))
      const grow = 1 + 0.22 * k * s
      return {
        ...REST_POSE,
        ty: 0.05 * k * s - 0.015 * k * bump,
        sx: grow,
        sy: grow,
        rotation: 0.015 * k * Math.sin((Math.PI * t) / 0.6 + p),
        depth: 0.12 * k * s,
        contact: 1 - bump * 0.15,
      }
    }
    case 'float': {
      const lift = 0.04 * k * (0.5 + 0.5 * Math.sin((TAU * t) / 3 + p))
      return {
        ...REST_POSE,
        ty: -lift,
        rotation: 0.03 * k * Math.sin((TAU * t) / 4.1 + p),
        bend: 0.015 * k * Math.sin((TAU * t) / 3.3 + p),
        contact: 1 - lift / Math.max(1e-6, 0.04),
      }
    }
  }
}

/**
 * The pose of an actor at a moment, respecting where its picture is cut off:
 * a body cut by the bottom edge may not rise or tilt (the cut would show), a
 * body cut by a side may not travel away from that side, and one cut at the
 * top may not shrink.
 */
export function actorPose(input: PoseInput): ActorPose {
  const pose = { ...rawPose(input) }
  const { edges } = input
  // Ease the action in over the first moment so a shot never starts mid-movement.
  const fade = smooth(0, 0.3, input.time)
  pose.tx *= fade
  pose.ty *= fade
  pose.rotation *= fade
  pose.bend *= fade
  pose.sx = 1 + (pose.sx - 1) * fade
  pose.sy = 1 + (pose.sy - 1) * fade
  if (edges.bottom) {
    pose.ty = Math.max(0, pose.ty)
    pose.rotation = 0
    pose.contact = 1
  }
  if ((edges.left && pose.tx > 0) || (edges.right && pose.tx < 0)) pose.tx = 0
  if (edges.left || edges.right) {
    // Tilting would swing the cut edge into view.
    pose.rotation *= 0.35
    pose.bend *= 0.5
  }
  if (edges.top) {
    pose.sy = Math.max(1, pose.sy)
    pose.ty = Math.min(0, pose.ty)
  }
  pose.contact = clamp(pose.contact, 0, 1)
  return pose
}

/** Where a point of the actor ends up (normalized actor-relative units; for tests and props). */
export function applyPose(pose: ActorPose, point: { x: number; y: number }): { x: number; y: number } {
  // point: x right, y down, relative to the anchor, in actor heights.
  const h = Math.max(0, -point.y)
  let x = point.x + pose.bend * h * h
  let y = point.y
  x *= pose.sx
  y *= pose.sy
  const c = Math.cos(pose.rotation)
  const s = Math.sin(pose.rotation)
  return { x: x * c - y * s + pose.tx, y: x * s + y * c + pose.ty }
}
