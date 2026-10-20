import type { CameraMove, CinematicSettings } from '@/core/types'
import { clamp, lerp } from '@/lib/math'
import { ease } from '../easing'

/**
 * Virtual camera for 2.5D depth parallax. A scene point at original screen
 * position o with disparity d (0 far … 1 near) appears at
 *
 *     s = c + (o − c) · m(d) + T · (d − pivot)
 *
 * where c is the frame center, T a lateral parallax shift (orbit/crane/truck)
 * and m(d) = base · (1 + dolly · d) / (1 + dolly · pivot) the depth-dependent
 * magnification of moving the camera forward (near things grow faster than
 * far ones). The pivot is the subject's disparity, so the subject stays
 * anchored while foreground and background move around it — the look of a
 * real camera move. The shader inverts this mapping by ray-marching.
 */
export interface CameraState {
  /** Lateral parallax in frame-uv units per unit of disparity. */
  shiftX: number
  shiftY: number
  /** Depth-dependent dolly amount (0 = none). */
  dolly: number
  /** Overall zoom (≥ 1 overscan keeps the frame filled while things move). */
  base: number
  /** Disparity that stays fixed on screen. */
  pivot: number
}

export interface CameraInput {
  move: CameraMove
  intensity: number
  /** 0..1 through the shot. */
  progress: number
  /** Subject disparity from depth analysis (0..1). */
  subject: number
  /** Per-scene seed for small variations (float drift phase). */
  seed: number
}

/**
 * Base zoom that keeps the frame covered. The far plane (d = 0) is the least
 * magnified: m(0) = base / (1 + dolly·pivot). An edge pixel stays outside the
 * frame when m(d) ≥ 1 + 2·|shift|·max(pivot, 1 − pivot), so solve for base
 * using the largest shift and the current dolly.
 */
function cover(maxShift: number, dolly: number, pivot: number): number {
  return (1 + 2 * Math.abs(maxShift)) * (1 + dolly * pivot) * 1.01
}

export function cameraAt({ move, intensity, progress, subject, seed }: CameraInput): CameraState {
  const k = clamp(intensity, 0, 1)
  const p = ease.easeInOut(clamp(progress, 0, 1))
  const shift = 0.01 + 0.035 * k
  const dolly = 0.12 + 0.4 * k
  const pivot = clamp(subject, 0.15, 0.9)
  const state = (shiftX: number, shiftY: number, d: number, maxShift: number, coverDolly = d, pv = pivot): CameraState => ({
    shiftX,
    shiftY,
    dolly: d,
    base: cover(maxShift, coverDolly, pv),
    pivot: pv,
  })
  switch (move) {
    case 'dollyIn':
    case 'dollyOut': {
      // Moving toward the subject: it grows, near things grow faster, the far plane holds still.
      const d = move === 'dollyIn' ? lerp(0, dolly, p) : lerp(dolly, 0, p)
      const drift = (move === 'dollyIn' ? p : 1 - p) * shift * 0.25
      return state(0, drift, d, shift * 0.25)
    }
    case 'orbitLeft':
    case 'orbitRight': {
      const dir = move === 'orbitLeft' ? -1 : 1
      return state(lerp(-shift, shift, p) * dir, 0, dolly * 0.25, shift)
    }
    case 'craneUp':
    case 'craneDown': {
      const dir = move === 'craneUp' ? 1 : -1
      return state(0, lerp(-shift, shift, p) * dir, lerp(0, dolly * 0.35, p), shift)
    }
    case 'truckLeft':
    case 'truckRight': {
      // A sideways track: everything slides, near things fastest (pivot near the far end).
      const dir = move === 'truckLeft' ? 1 : -1
      return state(lerp(-shift, shift, p) * dir, 0, dolly * 0.15, shift, dolly * 0.15, 0.05)
    }
    case 'float': {
      // Hand-held drift: a slow, seeded Lissajous wander with a gentle breathing dolly.
      const phase = ((seed % 1000) / 1000) * Math.PI * 2
      const t = clamp(progress, 0, 1) * Math.PI * 2
      const d = dolly * (0.3 + 0.2 * Math.sin(t * 0.5 + phase))
      return state(Math.sin(t * 0.9 + phase) * shift * 0.55, Math.cos(t * 0.7 + phase * 1.3) * shift * 0.4, d, shift * 0.55)
    }
    case 'vertigo': {
      // Dolly zoom: the subject keeps its size (constant base) while the background stretches away.
      return state(0, 0, lerp(0, dolly * 1.6, p), 0, dolly * 1.6)
    }
  }
}

/** Where a point at original screen position o with disparity d lands (forward mapping; used in tests). */
export function project(camera: CameraState, o: { x: number; y: number }, d: number): { x: number; y: number } {
  const m = (camera.base * (1 + camera.dolly * d)) / (1 + camera.dolly * camera.pivot)
  return {
    x: 0.5 + (o.x - 0.5) * m + camera.shiftX * (d - camera.pivot),
    y: 0.5 + (o.y - 0.5) * m + camera.shiftY * (d - camera.pivot),
  }
}

/** Focus distance (as disparity) for depth of field at a point in the shot. */
export function focusAt(settings: Pick<CinematicSettings, 'focus'>, subject: number, progress: number): number | null {
  if (settings.focus === 'none') return null
  if (settings.focus === 'subject') return subject
  // Rack focus: start on the background, pull to the subject a third of the way in.
  const t = ease.smooth(clamp((progress - 0.15) / 0.45, 0, 1))
  return lerp(Math.min(0.12, subject * 0.4), subject, t)
}
