import { describe, expect, it } from 'vitest'
import { actorDisparity, alignDepth, connectedComponents, dilate, groundDepth, layoutCutout, normalizeMatte, resampleNearest } from './cutoutPost'

/** A matte with filled rectangles (255 inside, a soft 1px edge of 60 around each). */
function matteWith(width: number, height: number, rects: [number, number, number, number][]): Uint8Array {
  const m = new Uint8Array(width * height)
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = Math.max(0, y0 - 1); y <= Math.min(height - 1, y1 + 1); y++) {
      for (let x = Math.max(0, x0 - 1); x <= Math.min(width - 1, x1 + 1); x++) {
        const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1
        m[y * width + x] = Math.max(m[y * width + x]!, inside ? 255 : 60)
      }
    }
  }
  return m
}

describe('cut-out post-processing', () => {
  it('finds 4-connected components with their sizes', () => {
    // 1 1 0 0
    // 1 0 0 1
    // 0 0 0 1
    // 1 0 0 1
    const mask = Uint8Array.from([1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1])
    const { ids, sizes } = connectedComponents(mask, 4, 4)
    expect(sizes.slice(1).toSorted((a, b) => a - b)).toEqual([1, 3, 3])
    expect(ids[0]).toBe(ids[1])
    expect(ids[0]).toBe(ids[4])
    expect(ids[7]).toBe(ids[15])
    expect(ids[0]).not.toBe(ids[7])
    expect(ids[12]).not.toBe(ids[0])
  })

  it('dilates by exactly r pixels', () => {
    const mask = new Uint8Array(11 * 11)
    mask[5 * 11 + 5] = 1
    const out = dilate(mask, 11, 11, 2)
    expect(out.reduce((a, b) => a + b, 0)).toBe(25)
    expect(out[3 * 11 + 3]).toBe(1)
    expect(out[2 * 11 + 5]).toBe(0)
  })

  it('normalizes a matte, leaving a flat prediction empty', () => {
    expect([...normalizeMatte(Float32Array.from([0.2, 0.6, 1]))]).toEqual([0, 128, 255])
    expect([...normalizeMatte(Float32Array.from([0.4, 0.4]))]).toEqual([0, 0])
  })

  it('turns two figures into two actors, largest first, with ground anchors', () => {
    const w = 100
    const h = 80
    // A tall figure standing at y=70 and a smaller one at the right edge.
    const matte = matteWith(w, h, [
      [20, 20, 34, 70],
      [90, 50, 99, 66],
    ])
    const layout = layoutCutout(matte, w, h)!
    expect(layout.actors).toHaveLength(2)
    const [big, small] = layout.actors
    expect(big!.area).toBeGreaterThan(small!.area)
    expect(big!.anchor[0]).toBeCloseTo(27.5 / w, 1)
    expect(big!.anchor[1]).toBeCloseTo(72 / h, 1)
    expect(big!.edges).toEqual({ left: false, right: false, top: false, bottom: false })
    expect(small!.edges.right).toBe(true)
    // Soft edge pixels belong to the nearest actor; the hole covers the actors with a margin.
    expect(layout.labels[19 * w + 27]).toBe(1)
    expect(layout.labels[50 * w + 95]).toBe(2)
    expect(layout.hole[45 * w + 27]).toBe(1)
    expect(layout.hole[45 * w + 37]).toBe(1)
    expect(layout.hole[45 * w + 60]).toBe(0)
  })

  it('ignores specks and refuses pictures that are all subject or no subject', () => {
    const w = 100
    const h = 100
    expect(layoutCutout(new Uint8Array(w * h), w, h)).toBeNull()
    expect(layoutCutout(matteWith(w, h, [[0, 0, 99, 99]]), w, h)).toBeNull()
    // One clear subject plus a speck: only the subject becomes an actor, the speck stays in the background.
    const layout = layoutCutout(matteWith(w, h, [
      [30, 30, 60, 90],
      [5, 5, 6, 6],
    ]), w, h)!
    expect(layout.actors).toHaveLength(1)
    expect(layout.hole[5 * w + 5]).toBe(0)
  })

  it('aligns the plate depth to the original scale where the pictures match', () => {
    const original = new Uint16Array(400)
    const plate = new Uint16Array(400)
    for (let i = 0; i < 400; i++) {
      plate[i] = i * 100
      original[i] = Math.round(i * 100 * 0.8 + 3000)
    }
    // Inside the "hole" the original holds the subject (much nearer); it must not skew the fit.
    for (let i = 100; i < 150; i++) original[i] = 65000
    const aligned = alignDepth(plate, original, (i) => i < 100 || i >= 150)
    expect(aligned[10]).toBeCloseTo(original[10]!, -1)
    expect(aligned[300]).toBeCloseTo(original[300]!, -1)
    expect(aligned[120]).toBeCloseTo(120 * 100 * 0.8 + 3000, -1)
  })

  it('measures the actors’ disparity and resamples labels without blending', () => {
    const depth = new Uint16Array(16).fill(10000)
    depth[5] = depth[6] = depth[9] = depth[10] = 50000
    const labels = new Uint8Array(64)
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) labels[y * 8 + x] = 1
    expect(actorDisparity(depth, 4, 4, labels, 8, 8)).toBeCloseTo(50000 / 65535, 3)
    const small = resampleNearest(labels, 8, 8, 4, 4)
    expect([...small]).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0])
  })

  it('measures the ground depth just above where an actor stands', () => {
    // Plate depth grows toward the bottom (ground coming closer); the actor stood at y = 0.8.
    const w = 50
    const h = 50
    const plate = new Uint16Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) plate[y * w + x] = Math.round((y / (h - 1)) * 65535)
    expect(groundDepth(plate, w, h, [0.5, 0.8])).toBeCloseTo(0.79, 1)
    expect(groundDepth(plate, w, h, [0.5, 0.3])).toBeLessThan(0.35)
  })

  it('keeps a soft object touching an actor (a ball by a head) in the background', () => {
    const w = 60
    const h = 60
    const matte = matteWith(w, h, [[20, 20, 35, 55]])
    // A faint ball just above the head, joined to the head's soft edge by a faint bridge.
    for (let y = 8; y <= 15; y++) for (let x = 24; x <= 31; x++) matte[y * w + x] = 90
    for (let y = 16; y <= 18; y++) matte[y * w + 27] = 30
    const layout = layoutCutout(matte, w, h)!
    expect(layout.actors).toHaveLength(1)
    expect(layout.labels[10 * w + 27]).toBe(0)
    expect(layout.labels[19 * w + 27]).toBe(1)
  })
})
