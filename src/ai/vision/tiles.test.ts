import { describe, expect, it } from 'vitest'
import { rampWeight, tileGrid, tileStarts } from './tiles'

describe('model tiling', () => {
  it('covers a picture with evenly spread, overlapping tiles that end at the edge', () => {
    expect(tileStarts(400, 512, 48)).toEqual([0])
    expect(tileStarts(768, 512, 48)).toEqual([0, 256])
    const starts = tileStarts(1500, 512, 48)
    expect(starts[0]).toBe(0)
    expect(starts.at(-1)! + 512).toBe(1500)
    for (let i = 1; i < starts.length; i++) expect(starts[i - 1]! + 512 - starts[i]!).toBeGreaterThanOrEqual(48)
    expect(tileGrid(768, 448)).toEqual([
      { x: 0, y: 0 },
      { x: 256, y: 0 },
    ])
  })

  it('blends only across overlaps, so weights sum smoothly and picture edges stay full', () => {
    // Two tiles over 768 px: at every pixel the overlapping weights are positive and edges are untouched.
    const starts = tileStarts(768, 512, 48)
    for (let x = 0; x < 768; x += 7) {
      const ws = starts.filter((s) => x >= s && x < s + 512).map((s) => rampWeight(x - s, s, 512, 768, 48))
      expect(ws.length).toBeGreaterThan(0)
      expect(Math.max(...ws)).toBeGreaterThan(0.3)
    }
    expect(rampWeight(0, 0, 512, 768, 48)).toBe(1)
    expect(rampWeight(511, 256, 512, 768, 48)).toBe(1)
    expect(rampWeight(0, 256, 512, 768, 48)).toBeLessThan(0.05)
  })
})
