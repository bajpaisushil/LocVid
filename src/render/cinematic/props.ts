import type { PropKind, SubjectAction } from '@/core/types'
import { clamp } from '@/lib/math'
import { ease } from '../easing'
import { kickTime, type ActorPose } from './subject'

/**
 * Choreography for 3D props added to a cinematic shot, as pure functions of
 * time (preview and export agree). The football plays with the main actor:
 * dribbled when it runs, juggled when it jumps, launched at the kick.
 * Positions are in frame units (x right, y down, 0..1) at the actor's ground
 * line; `lift` is height above the ground in actor heights.
 */

export interface BallState {
  /** Ground position under the ball (frame uv). */
  x: number
  y: number
  /** Height of the ball's bottom above the ground, in actor heights. */
  lift: number
  /** Radius in actor heights. */
  radius: number
  /** Extra disparity (flying toward the camera). */
  depth: number
  /** Rotation (radians, clockwise on screen): a rolling ball turns by distance / radius. */
  spin: number
  /** Opacity (0 once it has flown out of the shot). */
  alpha: number
}

export interface BallInput {
  action: SubjectAction
  direction: 1 | -1
  time: number
  duration: number
  /** The main actor: ground anchor (frame uv), height (frame-uv y units), width (frame-uv x units). */
  anchor: { x: number; y: number }
  height: number
  width: number
  pose: ActorPose
  /** Frame aspect (width / height), to convert between x and y frame units. */
  aspect: number
}

const BALL_RADIUS = 0.075

export function ballAt(input: BallInput): BallState {
  const { action, direction: dir, time: t, duration: D, anchor, height: H, width: W, pose, aspect } = input
  const r = BALL_RADIUS
  // Horizontal offsets are in actor heights; convert to frame x units.
  const hx = (v: number) => (v * H) / aspect
  const footX = anchor.x + hx(pose.tx) + dir * (W * 0.32 + hx(r))
  const base = { y: anchor.y, radius: r, depth: 0, alpha: 1 }
  switch (action) {
    case 'kick': {
      const hit = kickTime(D)
      if (t < hit) return { ...base, x: footX, lift: 0, spin: 0 }
      // Launched up and toward the camera: it grows and leaves the frame in under a second.
      const f = t - hit
      return {
        ...base,
        x: footX + dir * hx(1.4 * f),
        lift: 2.6 * f - 2.2 * f * f,
        depth: Math.min(0.6, 0.55 * f),
        spin: dir * 18 * f,
        alpha: 1 - clamp((f - 0.9) / 0.3, 0, 1),
      }
    }
    case 'walk':
    case 'run': {
      // Dribbled just ahead of the leading foot, bouncing a little with each touch.
      const step = action === 'run' ? 0.36 : 0.58
      const touches = Math.abs(Math.sin((Math.PI * t) / (step * 2)))
      const x = footX + dir * hx(0.06 * touches)
      return { ...base, x, lift: 0.05 * touches, spin: dir * (pose.tx / r + 2.5 * t) }
    }
    case 'jump': {
      // Keepie-uppie: up while the actor lands, down while it rises.
      const u = (t / 1.3) % 1
      return { ...base, x: footX - dir * hx(0.05), lift: 0.08 + 0.55 * Math.abs(Math.sin(Math.PI * (u + 0.5))), spin: t * 4 }
    }
    default: {
      // Rolls in from the other side and comes to rest by the feet.
      const p = ease.easeOut(clamp(t / Math.min(2.4, D * 0.6), 0, 1))
      const from = footX - dir * hx(2.2)
      const x = from + (footX - from) * p
      return { ...base, x, lift: 0, spin: (Math.abs(x - from) * aspect * dir) / (H * r) }
    }
  }
}

/** Sprite props drawn as GPU-animated instances (per-kind motion in the shader). */
export const SPRITE_PROPS = ['birds', 'balloons', 'butterflies', 'confetti', 'petals', 'leaves', 'lanterns'] as const
export type SpriteProp = (typeof SPRITE_PROPS)[number]

export const SPRITE_KIND: Record<SpriteProp, number> = { birds: 1, balloons: 2, butterflies: 3, confetti: 4, petals: 5, leaves: 6, lanterns: 7 }
export const SPRITE_COUNT: Record<SpriteProp, number> = { birds: 9, balloons: 9, butterflies: 6, confetti: 220, petals: 70, leaves: 45, lanterns: 16 }

export function isSpriteProp(kind: PropKind): kind is SpriteProp {
  return (SPRITE_PROPS as readonly string[]).includes(kind)
}
