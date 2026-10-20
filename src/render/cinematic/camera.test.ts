import { describe, expect, it } from 'vitest'
import type { CameraMove } from '@/core/types'
import { cameraAt, focusAt, project } from './camera'

const MOVES: CameraMove[] = ['dollyIn', 'dollyOut', 'orbitLeft', 'orbitRight', 'craneUp', 'craneDown', 'truckLeft', 'truckRight', 'float', 'vertigo']

describe('cinematic camera', () => {
  it('keeps the subject anchored for pivoting moves', () => {
    for (const move of ['orbitLeft', 'craneUp', 'vertigo'] as const) {
      const start = cameraAt({ move, intensity: 0.6, progress: 0, subject: 0.6, seed: 1 })
      const end = cameraAt({ move, intensity: 0.6, progress: 1, subject: 0.6, seed: 1 })
      const a = project(start, { x: 0.5, y: 0.5 }, 0.6)
      const b = project(end, { x: 0.5, y: 0.5 }, 0.6)
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-9)
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-9)
    }
  })

  it('moves near and far layers in opposite directions around the subject when orbiting', () => {
    const start = cameraAt({ move: 'orbitRight', intensity: 1, progress: 0, subject: 0.5, seed: 1 })
    const end = cameraAt({ move: 'orbitRight', intensity: 1, progress: 1, subject: 0.5, seed: 1 })
    const near = project(end, { x: 0.3, y: 0.5 }, 1).x - project(start, { x: 0.3, y: 0.5 }, 1).x
    const far = project(end, { x: 0.3, y: 0.5 }, 0).x - project(start, { x: 0.3, y: 0.5 }, 0).x
    expect(Math.sign(near)).toBe(-Math.sign(far))
    expect(Math.abs(near)).toBeGreaterThan(0.01)
  })

  it('dolly-in magnifies near objects more than far ones', () => {
    const cam = cameraAt({ move: 'dollyIn', intensity: 0.8, progress: 1, subject: 0.5, seed: 1 })
    const nearSize = project(cam, { x: 0.6, y: 0.5 }, 0.9).x - project(cam, { x: 0.4, y: 0.5 }, 0.9).x
    const farSize = project(cam, { x: 0.6, y: 0.5 }, 0.1).x - project(cam, { x: 0.4, y: 0.5 }, 0.1).x
    expect(nearSize).toBeGreaterThan(farSize)
  })

  it('overscans enough that frame corners stay inside the picture for every move', () => {
    for (const move of MOVES) {
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        for (const d of [0, 0.5, 1]) {
          const cam = cameraAt({ move, intensity: 1, progress, subject: 0.5, seed: 7 })
          // The picture edge (o at 0 or 1) must land at or beyond the frame edge.
          const left = project(cam, { x: 0, y: 0.5 }, d).x
          const right = project(cam, { x: 1, y: 0.5 }, d).x
          expect(left, `${move} @${progress} d=${d}`).toBeLessThanOrEqual(0.001)
          expect(right, `${move} @${progress} d=${d}`).toBeGreaterThanOrEqual(0.999)
        }
      }
    }
  })

  it('is deterministic', () => {
    expect(cameraAt({ move: 'float', intensity: 0.5, progress: 0.3, subject: 0.4, seed: 42 })).toEqual(
      cameraAt({ move: 'float', intensity: 0.5, progress: 0.3, subject: 0.4, seed: 42 }),
    )
  })

  it('rack focus pulls from the background to the subject', () => {
    expect(focusAt({ focus: 'none' }, 0.6, 0.5)).toBeNull()
    expect(focusAt({ focus: 'subject' }, 0.6, 0.1)).toBe(0.6)
    const start = focusAt({ focus: 'rack' }, 0.6, 0)!
    const end = focusAt({ focus: 'rack' }, 0.6, 1)!
    expect(start).toBeLessThan(0.2)
    expect(end).toBeCloseTo(0.6)
  })
})
