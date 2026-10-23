import type { WorldShot } from '@/core/types'
import type { Pitch, WorldFrame } from './choreography'

/**
 * Virtual camera work for 3D shots: each shot type is a rig that follows the
 * action like a camera operator would — establishing crane, tracking dolly,
 * close-up, low hero angle, orbit, aerial, ground-level detail, broadcast
 * wide, closing pull-back. Pure functions of the story, so preview and export
 * frame the same way.
 */

export interface CameraPose {
  position: [number, number, number]
  target: [number, number, number]
  /** Vertical field of view, degrees. */
  fov: number
}

export interface ShotInput {
  shot: WorldShot
  /** 0..1 through the shot. */
  progress: number
  /** Seconds since the shot began. */
  time: number
  now: WorldFrame
  /** The story at the moment the shot began (keeps a tracking camera on one side). */
  start: WorldFrame
  pitch: Pitch
  /** Height of the hero (m): framing scales with it. */
  heroHeight: number
}

const ease = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Stay inside the ring of houses and trees (radius in m), above the ground, out of the actors. */
function settle(p: [number, number, number], frame: WorldFrame, radius: number): [number, number, number] {
  let [x, y, z] = p
  const r = Math.hypot(x, z)
  if (r > radius) {
    x *= radius / r
    z *= radius / r
  }
  y = Math.max(0.25, y)
  for (const a of frame.actors) {
    const d = Math.hypot(x - a.x, z - a.z)
    if (d < 0.7 && y < 1.9) {
      const k = d > 1e-4 ? 0.7 / d : 0
      x = a.x + (x - a.x) * k + (k === 0 ? 0.7 : 0)
      z = a.z + (z - a.z) * k
    }
  }
  return [x, y, z]
}

export function cameraFor(input: ShotInput): CameraPose {
  const { shot, progress: u, time, now, start, heroHeight: H } = input
  const hero = now.actors[0]!
  const head = H * 0.88
  const s = now.smooth
  const dir = { x: Math.sin(s.heading), z: Math.cos(s.heading) }
  // Perpendicular to the hero's path, on the side chosen when the shot began (toward the −z "audience" side).
  const startSide = { x: Math.cos(start.smooth.heading), z: -Math.sin(start.smooth.heading) }
  const sign = startSide.z < 0 ? 1 : -1
  const side = { x: Math.cos(s.heading) * sign, z: -Math.sin(s.heading) * sign }
  // A hint of hand-held life on the closer shots.
  const hand = (a: number) => [Math.sin(time * 1.3 + a) * 0.015, Math.sin(time * 1.7 + a * 2) * 0.012, Math.sin(time * 1.1 + a * 3) * 0.015] as const
  let position: [number, number, number]
  let target: [number, number, number]
  let fov = 45
  let radius = 17

  switch (shot) {
    case 'establishing': {
      // From the audience side (−z), craning down and in toward the action.
      const e = ease(u)
      const f = now.focus
      position = [f.x + lerp(-6, -3, e), lerp(8, 3.4, e), f.z - lerp(15, 9, e)]
      target = [f.x, lerp(0.5, 0.85, e), f.z]
      fov = 46
      break
    }
    case 'tracking': {
      const [hx, hy, hz] = hand(1)
      position = [s.x + side.x * 5.2 - dir.x * 1.2 + hx, 1.45 + hy, s.z + side.z * 5.2 - dir.z * 1.2 + hz]
      target = [s.x + dir.x * 1.3, H * 0.6, s.z + dir.z * 1.3]
      fov = 42
      break
    }
    case 'closeup': {
      const face = { x: Math.sin(hero.heading), z: Math.cos(hero.heading) }
      const across = { x: Math.cos(hero.heading), z: -Math.sin(hero.heading) }
      const dist = lerp(2.1, 1.5, ease(u)) * (H / 1.3)
      const [hx, hy, hz] = hand(2)
      position = [hero.x + face.x * dist + across.x * 0.45 + hx, head * 0.97 + hy, hero.z + face.z * dist + across.z * 0.45 + hz]
      target = [hero.x, head * 0.93, hero.z]
      fov = 32
      break
    }
    case 'low': {
      const face = { x: Math.sin(hero.heading), z: Math.cos(hero.heading) }
      position = [hero.x + face.x * 2.8 + side.x * 1.5, 0.32, hero.z + face.z * 2.8 + side.z * 1.5]
      target = [hero.x, H * 0.72, hero.z]
      fov = 56
      break
    }
    case 'orbit': {
      const a0 = Math.atan2(startSide.x * sign, startSide.z * sign)
      const a = a0 + 0.5 * time
      position = [hero.x + Math.sin(a) * 4.3, 1.55, hero.z + Math.cos(a) * 4.3]
      target = [hero.x, H * 0.68, hero.z]
      fov = 46
      break
    }
    case 'aerial': {
      const a = -0.6 + 0.12 * time
      position = [s.x + Math.sin(a) * 6, 15.5, s.z - Math.cos(a) * 6 - 4]
      target = [s.x, 0, s.z]
      fov = 50
      radius = 30
      break
    }
    case 'detail': {
      // Ground level at the hero's feet (the ball comes into frame whenever it's at them).
      const fx = s.x + dir.x * 0.35
      const fz = s.z + dir.z * 0.35
      position = [fx + side.x * 1.9 - dir.x * 0.6, 0.45, fz + side.z * 1.9 - dir.z * 0.6]
      target = [fx + dir.x * 0.4, 0.32, fz + dir.z * 0.4]
      fov = 40
      break
    }
    case 'wide': {
      const f = now.focus
      position = [f.x * 0.6, 3.6, -15.5]
      target = [f.x, 0.8, f.z * 0.8]
      fov = 38
      break
    }
    case 'pullback': {
      const e = ease(u)
      position = [s.x + side.x * lerp(3, 12, e) + dir.x * lerp(2, 6, e), lerp(1.6, 9.5, e), s.z + side.z * lerp(3, 12, e) + dir.z * lerp(2, 6, e)]
      target = [s.x, lerp(H * 0.6, 0.3, e), s.z]
      fov = lerp(44, 52, e)
      radius = 20
      break
    }
  }
  position = settle(position, now, radius)
  position[1] = clamp(position[1], 0.25, 40)
  return { position, target, fov }
}
