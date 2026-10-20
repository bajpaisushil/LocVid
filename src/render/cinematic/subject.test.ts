import { describe, expect, it } from 'vitest'
import type { SubjectAction } from '@/core/types'
import { actorPose, applyPose, kickTime, type PoseInput } from './subject'

const free = { left: false, right: false, top: false, bottom: false }
const at = (action: SubjectAction, time: number, extra: Partial<PoseInput> = {}) =>
  actorPose({ action, amount: 0.8, direction: 1, time, duration: 5, phase: 0, edges: free, ...extra })

const ACTIONS: SubjectAction[] = ['breathe', 'sway', 'walk', 'run', 'jump', 'dance', 'kick', 'approach', 'float']

describe('subject animation', () => {
  it('starts every action from rest, so a shot never opens mid-movement', () => {
    for (const action of ACTIONS) {
      const p = at(action, 0)
      expect(p.tx).toBeCloseTo(0, 6)
      expect(p.ty).toBeCloseTo(0, 6)
      expect(p.rotation).toBeCloseTo(0, 6)
    }
  })

  it('is a pure function of time (preview and export agree)', () => {
    for (const action of ACTIONS) expect(at(action, 2.37)).toEqual(at(action, 2.37))
  })

  it('jumps leave the ground and come back down', () => {
    const heights = Array.from({ length: 120 }, (_, i) => -at('jump', 1 + i * 0.01).ty)
    expect(Math.max(...heights)).toBeGreaterThan(0.12)
    expect(Math.min(...heights)).toBeCloseTo(0, 6)
    const top = at('jump', 1 + heights.indexOf(Math.max(...heights)) * 0.01)
    expect(top.contact).toBeLessThan(0.2)
  })

  it('walks and runs travel the way the subject faces, running farther', () => {
    expect(at('walk', 4).tx).toBeGreaterThan(0.2)
    expect(at('walk', 4, { direction: -1 }).tx).toBeLessThan(-0.2)
    expect(at('run', 4).tx).toBeGreaterThan(at('walk', 4).tx)
    // Leaning into the direction of travel.
    expect(at('run', 2).bend).toBeGreaterThan(0)
  })

  it('kicks lean back, then strike forward around the kick time', () => {
    const hit = kickTime(5)
    expect(at('kick', hit - 0.12).rotation).toBeLessThan(0)
    expect(at('kick', hit + 0.08).rotation).toBeGreaterThan(0.05)
    expect(Math.abs(at('kick', 4.9).rotation)).toBeLessThan(0.02)
  })

  it('approaching subjects grow and come closer', () => {
    const end = at('approach', 5)
    expect(end.sx).toBeGreaterThan(1.15)
    expect(end.depth).toBeGreaterThan(0.08)
  })

  it('never reveals where a subject is cut off by the picture edge', () => {
    const cutBottom = { ...free, bottom: true }
    for (const action of ACTIONS) {
      for (let t = 0; t < 5; t += 0.05) {
        const p = at(action, t, { edges: cutBottom })
        expect(p.ty).toBeGreaterThanOrEqual(0)
        expect(p.rotation).toBe(0)
      }
    }
    // Cut on the left: may walk left (off the picture) but not right.
    expect(at('walk', 4, { edges: { ...free, left: true } }).tx).toBe(0)
    expect(at('walk', 4, { edges: { ...free, left: true }, direction: -1 }).tx).toBeLessThan(0)
    // Cut at the top: never shrinks or drops.
    for (let t = 0; t < 5; t += 0.05) expect(at('jump', t, { edges: { ...free, top: true } }).sy).toBeGreaterThanOrEqual(1)
  })

  it('keeps the feet planted while swaying and breathing', () => {
    for (const action of ['sway', 'breathe'] as const) {
      const foot = applyPose(at(action, 1.7), { x: 0, y: 0 })
      expect(foot.x).toBeCloseTo(0, 9)
      expect(foot.y).toBeCloseTo(0, 9)
      const head = applyPose(at(action, 1.7), { x: 0, y: -1 })
      expect(Math.hypot(head.x, head.y + 1)).toBeGreaterThan(0.001)
    }
  })

  it('spreads walking and running over the room the frame leaves', () => {
    const roomy = at('run', 4.9, { room: 0.6 })
    expect(roomy.tx).toBeLessThanOrEqual(0.6)
    expect(roomy.tx).toBeGreaterThan(0.45)
    // Halfway through the shot it is still on its way, not already at the edge.
    expect(at('run', 2.5, { room: 0.6 }).tx).toBeLessThan(0.4)
    expect(at('walk', 3, { room: 0 }).tx).toBe(0)
  })
})
