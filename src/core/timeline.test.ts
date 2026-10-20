import { describe, expect, it } from 'vitest'
import { createProject, createScene } from './defaults'
import {
  buildTimeline,
  frameAt,
  frameCount,
  motionProgress,
  overlayTiming,
  sceneIndexAt,
  totalDuration,
  videoSourceTime,
} from './timeline'
import type { Project, Scene, TransitionType } from './types'

function sceneWith(duration: number, transition: TransitionType = 'none', transitionDuration = 0.6): Scene {
  const s = createScene({ duration })
  s.transition = { type: transition, duration: transitionDuration }
  return s
}

function projectWith(scenes: Scene[], fadeOutEnd = 0): Project {
  return { ...createProject(), scenes, fadeOutEnd }
}

describe('durations', () => {
  it('total duration is the sum of scene durations, regardless of transitions', () => {
    const scenes = [sceneWith(5), sceneWith(3.5, 'crossfade', 1), sceneWith(2.25, 'slideLeft', 0.5)]
    expect(totalDuration(scenes)).toBe(10.75)
    expect(buildTimeline(projectWith(scenes)).duration).toBe(10.75)
  })

  it('avoids floating point noise', () => {
    const scenes = [sceneWith(0.1), sceneWith(0.2)]
    expect(totalDuration(scenes)).toBe(0.3)
  })

  it('empty project has zero duration and an empty frame', () => {
    const tl = buildTimeline(projectWith([]))
    expect(tl.duration).toBe(0)
    expect(frameAt(tl, 0).plan.kind).toBe('empty')
    expect(sceneIndexAt(tl, 3)).toBe(-1)
  })

  it('computes scene start/end positions in order', () => {
    const tl = buildTimeline(projectWith([sceneWith(4), sceneWith(6), sceneWith(2)]))
    expect(tl.entries.map((e) => [e.start, e.end])).toEqual([
      [0, 4],
      [4, 10],
      [10, 12],
    ])
  })

  it('frame count rounds duration × fps', () => {
    expect(frameCount(10, 30)).toBe(300)
    expect(frameCount(10.75, 30)).toBe(323)
    expect(frameCount(0, 30)).toBe(0)
  })
})

describe('scene lookup', () => {
  const tl = buildTimeline(projectWith([sceneWith(4), sceneWith(6), sceneWith(2)]))

  it('finds the scene containing a time', () => {
    expect(sceneIndexAt(tl, 0)).toBe(0)
    expect(sceneIndexAt(tl, 3.99)).toBe(0)
    expect(sceneIndexAt(tl, 4)).toBe(1)
    expect(sceneIndexAt(tl, 9.5)).toBe(1)
    expect(sceneIndexAt(tl, 11)).toBe(2)
  })

  it('clamps out-of-range times', () => {
    expect(sceneIndexAt(tl, -5)).toBe(0)
    expect(sceneIndexAt(tl, 99)).toBe(2)
  })

  it('plans a plain cut with no transitions', () => {
    const f = frameAt(tl, 5)
    expect(f.plan.kind).toBe('scene')
    if (f.plan.kind === 'scene') {
      expect(f.plan.entry.index).toBe(1)
      expect(f.plan.localTime).toBeCloseTo(1)
    }
    expect(f.fade).toBeNull()
  })

  it('renders the last frame for t at or past the end', () => {
    const f = frameAt(tl, 12)
    expect(f.plan.kind).toBe('scene')
    if (f.plan.kind === 'scene') expect(f.plan.entry.index).toBe(2)
  })
})

describe('transitions', () => {
  it('centers the transition window on the cut', () => {
    const tl = buildTimeline(projectWith([sceneWith(4), sceneWith(4, 'crossfade', 1)]))
    const [a, b] = tl.entries
    expect(a!.visibleEnd).toBe(4.5)
    expect(b!.visibleStart).toBe(3.5)

    expect(frameAt(tl, 3.4).plan.kind).toBe('scene')
    const mid = frameAt(tl, 4).plan
    expect(mid.kind).toBe('transition')
    if (mid.kind === 'transition') {
      expect(mid.progress).toBeCloseTo(0.5)
      expect(mid.from.index).toBe(0)
      expect(mid.to.index).toBe(1)
      expect(mid.type).toBe('crossfade')
      expect(mid.fromLocal).toBeCloseTo(4)
      expect(mid.toLocal).toBeCloseTo(0)
    }
    const early = frameAt(tl, 3.6).plan
    expect(early.kind === 'transition' && early.progress).toBeCloseTo(0.1)
    const late = frameAt(tl, 4.4).plan
    expect(late.kind === 'transition' && late.progress).toBeCloseTo(0.9)
    expect(frameAt(tl, 4.5).plan.kind).toBe('scene')
  })

  it('caps transitions at half of either neighbour', () => {
    const tl = buildTimeline(projectWith([sceneWith(1), sceneWith(10, 'crossfade', 2)]))
    expect(tl.entries[1]!.inDuration).toBe(0.5)
    expect(tl.entries[0]!.outDuration).toBe(0.5)
  })

  it('never shows more than two scenes at once', () => {
    const scenes = [sceneWith(1), sceneWith(1, 'crossfade', 2), sceneWith(1, 'crossfade', 2)]
    const tl = buildTimeline(projectWith(scenes))
    for (let t = 0; t < tl.duration; t += 0.01) {
      const visible = tl.entries.filter((e) => t >= e.visibleStart && t < e.visibleEnd)
      expect(visible.length).toBeLessThanOrEqual(2)
    }
  })

  it('treats the first scene transition as a fade-in from black', () => {
    const tl = buildTimeline(projectWith([sceneWith(4, 'crossfade', 1), sceneWith(4)]))
    expect(tl.entries[0]!.inDuration).toBe(0)
    expect(tl.fadeIn).toBe(1)
    expect(frameAt(tl, 0).fade).toEqual({ color: 'black', alpha: 1 })
    expect(frameAt(tl, 0.5).fade?.alpha).toBeCloseTo(0.5)
    expect(frameAt(tl, 1.5).fade).toBeNull()
  })

  it('fades to black at the end when configured', () => {
    const tl = buildTimeline(projectWith([sceneWith(4), sceneWith(4)], 2))
    expect(frameAt(tl, 5).fade).toBeNull()
    expect(frameAt(tl, 7).fade?.alpha).toBeCloseTo(0.5)
  })
})

describe('motion and video timing', () => {
  const tl = buildTimeline(projectWith([sceneWith(4), sceneWith(4, 'crossfade', 1)]))
  const second = tl.entries[1]!

  it('motion spans the visible window', () => {
    expect(motionProgress(second, -0.5)).toBe(0)
    expect(motionProgress(second, 4)).toBeCloseTo(1)
    expect(motionProgress(second, 1.75)).toBeCloseTo(0.5)
  })

  it('video starts when the scene becomes visible', () => {
    expect(videoSourceTime(second, -0.5, 2, 30, false)).toBe(2)
    expect(videoSourceTime(second, 0, 2, 30, false)).toBe(2.5)
  })

  it('holds the last frame of a short clip without loop', () => {
    expect(videoSourceTime(second, 3, 0, 2, false)).toBeCloseTo(1.999)
  })

  it('loops a short clip when requested', () => {
    expect(videoSourceTime(second, 2, 0, 2, true)).toBeCloseTo(0.5)
  })
})

describe('overlay timing', () => {
  const tl = buildTimeline(projectWith([sceneWith(4), sceneWith(4, 'crossfade', 1)]))

  it('defaults to the whole scene, extended through the outgoing transition', () => {
    const first = tl.entries[0]!
    const overlay = { ...first.scene.overlays[0], start: 0, end: null, animationIn: 'fade', animationOut: 'fade' } as never
    const timing = overlayTiming(overlay, first)
    expect(timing.start).toBe(0)
    expect(timing.end).toBe(4.5)
    expect(timing.animIn).toBe(0.5)
  })

  it('a non-animated overlay starting at 0 is visible during the incoming transition', () => {
    const second = tl.entries[1]!
    const overlay = { start: 0, end: 2, animationIn: 'none', animationOut: 'none' } as never
    const timing = overlayTiming(overlay, second)
    expect(timing.start).toBe(-0.5)
    expect(timing.end).toBe(2)
    expect(timing.animIn).toBe(0)
  })
})
