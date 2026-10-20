import { describe, expect, it } from 'vitest'
import { depthInputSize, farRegionMask, layeredDepth, maxMinFilter, normalizeDisparity, occluderMask, pushPullFill, subjectBox, subjectDisparity } from './depthPost'

function image(width: number, height: number, f: (x: number, y: number) => number): Uint16Array {
  const out = new Uint16Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = Math.round(f(x, y) * 65535)
  return out
}

describe('depth post-processing', () => {
  it('normalizes raw disparity to the full 16-bit range', () => {
    const out = normalizeDisparity(new Float32Array([2, 4, 6]))
    expect([...out]).toEqual([0, 32768, 65535])
  })

  it('handles a constant depth map without dividing by zero', () => {
    expect([...normalizeDisparity(new Float32Array([3, 3]))]).toEqual([0, 0])
  })

  it('marks the far region connected to the top edge, not distant islands', () => {
    // Top 3 rows are sky (far); a far "hole" in the middle of the ground must stay unmarked.
    const w = 10
    const h = 10
    const depth = image(w, h, (x, y) => (y < 3 ? 0 : x === 5 && y === 7 ? 0 : 0.8))
    const mask = farRegionMask(depth, w, h)
    expect(mask[0]).toBe(1)
    expect(mask[2 * w + 9]).toBe(1)
    expect(mask[3 * w]).toBe(0)
    expect(mask[7 * w + 5]).toBe(0)
  })

  it('ignores a tiny far speck at the top', () => {
    const depth = image(100, 100, (x, y) => (x === 0 && y === 0 ? 0 : 0.9))
    expect(farRegionMask(depth, 100, 100).every((m) => m === 0)).toBe(true)
  })

  it('estimates the subject depth from the central area', () => {
    const depth = image(100, 100, (x, y) => (x > 30 && x < 70 && y > 30 && y < 80 ? 0.7 : 0.2))
    expect(subjectDisparity(depth, 100, 100)).toBeCloseTo(0.7, 1)
  })

  it('computes model input sizes like the DPT image processor', () => {
    expect(depthInputSize(512, 512)).toEqual({ width: 518, height: 518 })
    expect(depthInputSize(1600, 900)).toEqual({ width: 924, height: 518 })
    // Very wide images are capped on the long side to bound inference time.
    const pano = depthInputSize(6000, 1000)
    expect(pano.width).toBe(924)
    expect(pano.height % 14).toBe(0)
  })
})

// A near square (disparity 0.8) on a far background (0.1).
const near = (x: number, y: number) => x >= 15 && x < 25 && y >= 15 && y < 25

describe('layered depth', () => {
  const W = 40
  const H = 40
  const depth = image(W, H, (x, y) => (near(x, y) ? 0.8 : 0.1))

  it('max/min filters see a window of the given radius', () => {
    const { max, min } = maxMinFilter(depth, W, H, 2)
    expect(max[13 * W + 13]).toBe(Math.round(0.8 * 65535)) // 2 px away from the square
    expect(max[12 * W + 12]).toBe(Math.round(0.1 * 65535))
    expect(min[20 * W + 20]).toBe(Math.round(0.8 * 65535)) // deep inside the square
  })

  it('marks only the near side of a strong depth edge', () => {
    const mask = occluderMask(depth, W, H, 4, 0.12)
    expect(mask[15 * W + 15]).toBe(1) // near pixel at the edge
    expect(mask[14 * W + 14]).toBe(0) // far pixel next to the edge stays
    expect(mask[2 * W + 2]).toBe(0) // far field
    expect(mask[20 * W + 20]).toBe(0) // near interior, farther than r from any edge
  })

  it('push-pull fills holes smoothly from their surroundings', () => {
    const values = new Float32Array(W * H).fill(7)
    const valid = new Uint8Array(W * H).fill(1)
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) {
      valid[y * W + x] = 0
      values[y * W + x] = 999
    }
    const out = pushPullFill(values, 1, W, H, valid)
    expect(Math.max(...out)).toBeCloseTo(7, 4)
    expect(Math.min(...out)).toBeCloseTo(7, 4)
  })

  it('fills the background behind a near object with background color and depth', () => {
    const rgba = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      rgba.set(near(x, y) ? [255, 0, 0, 255] : [0, 0, 255, 255], i)
    }
    const layered = layeredDepth(rgba, depth, W, H)
    const edge = 15 * W + 15
    expect(layered.hole[edge]).toBe(1)
    expect(layered.fill[edge * 4 + 2]).toBeGreaterThan(200) // blue background, not the red object
    expect(layered.fill[edge * 4]).toBeLessThan(60)
    expect(layered.bgDepth[edge]! / 65535).toBeLessThan(0.2)
  })

  it('keeps textured distant structures out of the sky mask', () => {
    const w = 20
    const h = 20
    const far = image(w, h, () => 0)
    const texture = new Float32Array(w * h)
    for (let y = 6; y < 10; y++) for (let x = 0; x < w; x++) texture[y * w + x] = 0.3 // a row of "buildings"
    const mask = farRegionMask(far, w, h, 0.06, texture)
    expect(mask[2 * w + 5]).toBe(1)
    expect(mask[7 * w + 5]).toBe(0)
    expect(mask[15 * w + 5]).toBe(0) // below the buildings: not connected to the sky
  })
})

describe('subject box', () => {
  it('finds the near subject region', () => {
    const depth = image(100, 100, (x, y) => (x >= 60 && x < 80 && y >= 20 && y < 70 ? 0.8 : 0.1))
    const [x, y, w, h] = subjectBox(depth, 100, 100, 0.8)
    expect(x).toBeGreaterThan(0.55)
    expect(x + w).toBeLessThan(0.85)
    expect(y).toBeGreaterThan(0.15)
    expect(y + h).toBeLessThan(0.75)
  })
  it('falls back to a centered box when nothing stands out', () => {
    expect(subjectBox(image(50, 50, () => 0.1), 50, 50, 0.9)).toEqual([0.25, 0.2, 0.5, 0.6])
  })
})
