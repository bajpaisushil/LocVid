import type { MotionSettings } from '@/core/types'
import { createRng } from '@/lib/math'
import { lerp } from '@/lib/math'
import { applyEasing } from './easing'
import type { Rect } from './fit'

/** Camera state: zoom factor and offset (fractions of frame width/height). */
export interface Camera {
  scale: number
  x: number
  y: number
}

const IDENTITY: Camera = { scale: 1, x: 0, y: 0 }

/** Zoom travel for an intensity of 0..1. */
function amount(intensity: number): number {
  return 0.06 + 0.24 * intensity
}

/** Max pan at a given scale that keeps a frame-covering image covering the frame. */
function panRoom(scale: number): number {
  return Math.max(0, (scale - 1) / 2) * 0.96
}

function between(a: Camera, b: Camera, t: number): Camera {
  return { scale: lerp(a.scale, b.scale, t), x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}

function keyframes(motion: MotionSettings, seed: number): [Camera, Camera] {
  const a = amount(motion.intensity)
  const s = 1 + a
  const m = panRoom(s)
  switch (motion.preset) {
    case 'none':
      return [IDENTITY, IDENTITY]
    case 'zoomIn':
      return [IDENTITY, { scale: s, x: 0, y: 0 }]
    case 'zoomOut':
      return [{ scale: s, x: 0, y: 0 }, IDENTITY]
    case 'panLeft':
      return [
        { scale: s, x: m, y: 0 },
        { scale: s, x: -m, y: 0 },
      ]
    case 'panRight':
      return [
        { scale: s, x: -m, y: 0 },
        { scale: s, x: m, y: 0 },
      ]
    case 'panUp':
      return [
        { scale: s, x: 0, y: m },
        { scale: s, x: 0, y: -m },
      ]
    case 'panDown':
      return [
        { scale: s, x: 0, y: -m },
        { scale: s, x: 0, y: m },
      ]
    case 'kenBurns':
    case 'parallax': {
      // Seeded so each scene drifts in its own direction, identically in preview and export.
      const rng = createRng(seed)
      const angle = rng() * Math.PI * 2
      const zoomingIn = rng() > 0.35
      const near = 1 + a * 0.2
      const far = s
      const [s0, s1] = zoomingIn ? [near, far] : [far, near]
      const dx = Math.cos(angle)
      const dy = Math.sin(angle)
      return [
        { scale: s0, x: -dx * panRoom(s0) * 0.8, y: -dy * panRoom(s0) * 0.8 },
        { scale: s1, x: dx * panRoom(s1) * 0.8, y: dy * panRoom(s1) * 0.8 },
      ]
    }
  }
}

export function cameraAt(motion: MotionSettings, progress: number, seed: number): Camera {
  const [from, to] = keyframes(motion, seed)
  return between(from, to, applyEasing(motion.easing, progress))
}

/** Layer cameras for the parallax preset: the blurred backdrop drifts more than the foreground card. */
export function parallaxCameras(motion: MotionSettings, progress: number, seed: number): { back: Camera; front: Camera } {
  const cam = cameraAt({ ...motion, preset: 'kenBurns' }, progress, seed)
  const back: Camera = { scale: 1.15 + (cam.scale - 1) * 1.4, x: cam.x * 2.2, y: cam.y * 2.2 }
  const front: Camera = { scale: 1 + (cam.scale - 1) * 0.45, x: -cam.x * 0.5, y: -cam.y * 0.5 }
  return { back, front }
}

/** Apply a camera to a destination rect: scale about the frame center, then offset. */
export function applyCamera(rect: Rect, camera: Camera, frameW: number, frameH: number): Rect {
  const cx = frameW / 2
  const cy = frameH / 2
  return {
    x: cx + (rect.x - cx) * camera.scale + camera.x * frameW,
    y: cy + (rect.y - cy) * camera.scale + camera.y * frameH,
    width: rect.width * camera.scale,
    height: rect.height * camera.scale,
  }
}
