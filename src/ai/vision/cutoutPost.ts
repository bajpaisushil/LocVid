/**
 * Post-processing of a salient-object matte (IS-Net) into what subject
 * animation needs:
 *  - "actors": the few big connected subjects (a person, two kids, a dog),
 *    each with its bounds, the point where it meets the ground, and whether
 *    it runs off an edge of the picture (which limits how it may move);
 *  - a label map that gives every soft edge pixel to its nearest actor;
 *  - the hole to inpaint for the clean background plate;
 *  - a depth alignment so the plate's own depth map matches the original's
 *    scale (each depth map is normalized separately).
 * Small salient bits that aren't actors stay part of the background.
 */

import type { CutoutActor } from '@/storage/db'

export type Actor = CutoutActor

export interface CutoutLayout {
  actors: Actor[]
  /** Uint8 per pixel: 0 = background, k = actor k. */
  labels: Uint8Array
  /** Uint8 0/1 — area to remove and inpaint (actors plus a safety margin). */
  hole: Uint8Array
}

/** 4-connected components of `mask` (non-zero = inside). Returns ids (0 = none) and pixel counts per id. */
export function connectedComponents(mask: Uint8Array, width: number, height: number): { ids: Int32Array; sizes: number[] } {
  const ids = new Int32Array(width * height)
  const sizes = [0]
  const stack: number[] = []
  let next = 1
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || ids[start]) continue
    let size = 0
    ids[start] = next
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      size++
      const x = i % width
      if (x > 0 && mask[i - 1] && !ids[i - 1]) {
        ids[i - 1] = next
        stack.push(i - 1)
      }
      if (x < width - 1 && mask[i + 1] && !ids[i + 1]) {
        ids[i + 1] = next
        stack.push(i + 1)
      }
      if (i >= width && mask[i - width] && !ids[i - width]) {
        ids[i - width] = next
        stack.push(i - width)
      }
      if (i + width < mask.length && mask[i + width] && !ids[i + width]) {
        ids[i + width] = next
        stack.push(i + width)
      }
    }
    sizes.push(size)
    next++
  }
  return { ids, sizes }
}

/** Separable square dilation of a 0/1 mask by `r` pixels (sliding-window counts, O(n)). */
export function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice()
  const tmp = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let count = 0
    for (let x = 0; x <= Math.min(width - 1, r); x++) count += mask[row + x]!
    for (let x = 0; x < width; x++) {
      tmp[row + x] = count > 0 ? 1 : 0
      const add = x + r + 1
      const remove = x - r
      if (add < width) count += mask[row + add]!
      if (remove >= 0) count -= mask[row + remove]!
    }
  }
  const out = new Uint8Array(mask.length)
  for (let x = 0; x < width; x++) {
    let count = 0
    for (let y = 0; y <= Math.min(height - 1, r); y++) count += tmp[y * width + x]!
    for (let y = 0; y < height; y++) {
      out[y * width + x] = count > 0 ? 1 : 0
      const add = y + r + 1
      const remove = y - r
      if (add < height) count += tmp[add * width + x]!
      if (remove >= 0) count -= tmp[remove * width + x]!
    }
  }
  return out
}

/** Min–max normalize a raw matte to 0..255. */
export function normalizeMatte(raw: Float32Array): Uint8Array {
  let lo = Infinity
  let hi = -Infinity
  for (const v of raw) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const range = hi - lo
  const out = new Uint8Array(raw.length)
  // A flat output (nothing salient) stays all background.
  if (!(range > 1e-6)) return out
  for (let i = 0; i < raw.length; i++) out[i] = Math.round(((raw[i]! - lo) / range) * 255)
  return out
}

const MAX_ACTORS = 3

/**
 * Pick actors from a matte (0..255). Returns null when there is no clear
 * subject — nothing salient, or "everything" salient (a close-up that fills
 * the frame can't be separated from a background it hides).
 */
export function layoutCutout(matte: Uint8Array, width: number, height: number): CutoutLayout | null {
  const n = width * height
  const core = new Uint8Array(n)
  for (let i = 0; i < n; i++) core[i] = matte[i]! >= 128 ? 1 : 0
  const { ids, sizes } = connectedComponents(core, width, height)
  const largest = Math.max(0, ...sizes)
  if (largest < n * 0.004) return null
  const chosen = sizes
    .map((size, id) => ({ id, size }))
    .filter((c) => c.id > 0 && c.size >= Math.max(n * 0.004, largest * 0.15))
    .toSorted((a, b) => b.size - a.size)
    .slice(0, MAX_ACTORS)
  const total = chosen.reduce((t, c) => t + c.size, 0)
  if (total > n * 0.6) return null

  // Label each chosen component's core, then grow labels outward into the soft edge (nearest actor wins).
  const labels = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  chosen.forEach((c, k) => {
    for (let i = 0; i < n; i++) {
      if (ids[i] === c.id) {
        labels[i] = k + 1
        queue[tail++] = i
      }
    }
  })
  while (head < tail) {
    const i = queue[head++]!
    const x = i % width
    const neighbors = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]
    for (const j of neighbors) {
      if (j < 0 || j >= n || labels[j] || matte[j]! < 10) continue
      // An unlabeled core pixel belongs to a component that isn't an actor.
      if (ids[j]) continue
      // Only downhill: an actor's soft edge fades outward; climbing back up means another object
      // (a ball touching a head) that must stay in the background.
      if (matte[j]! > matte[i]! + 6) continue
      labels[j] = labels[i]!
      queue[tail++] = j
    }
  }

  const actors: Actor[] = chosen.map((c, k) => {
    const label = k + 1
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    for (let i = 0; i < n; i++) {
      if (labels[i] !== label) continue
      const x = i % width
      const y = (i - x) / width
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    // Ground contact: centroid of the lowest 6% of the actor's core.
    const band = Math.max(1, Math.round((y1 - y0 + 1) * 0.06))
    let sx = 0
    let count = 0
    for (let y = Math.max(y0, y1 - band); y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (ids[y * width + x] === c.id) {
          sx += x
          count++
        }
      }
    }
    const ax = count ? sx / count : (x0 + x1) / 2
    const margin = 2
    return {
      box: [x0 / width, y0 / height, (x1 - x0 + 1) / width, (y1 - y0 + 1) / height],
      anchor: [(ax + 0.5) / width, (y1 + 1) / height],
      label,
      area: c.size / n,
      edges: { left: x0 <= margin, right: x1 >= width - 1 - margin, top: y0 <= margin, bottom: y1 >= height - 1 - margin },
      // Measured once the clean plate's depth is known (see groundDepth).
      depth: 0.5,
    }
  })

  // Remove the actors (and their soft halo) from the background, with a margin for edge colors and contact shadows.
  const actorArea = new Uint8Array(n)
  for (let i = 0; i < n; i++) actorArea[i] = labels[i] && matte[i]! >= 20 ? 1 : 0
  const hole = dilate(actorArea, width, height, Math.max(2, Math.round(Math.max(width, height) * 0.012)))
  return { actors, labels, hole }
}

/**
 * Least-squares scale and offset mapping the plate's depth onto the original
 * depth scale, fitted where the two pictures are identical (outside the hole).
 */
export function alignDepth(plate: Uint16Array, original: Uint16Array, valid: (i: number) => boolean): Uint16Array {
  let sp = 0
  let so = 0
  let spp = 0
  let spo = 0
  let count = 0
  const step = Math.max(1, Math.floor(plate.length / 60_000))
  for (let i = 0; i < plate.length; i += step) {
    if (!valid(i)) continue
    const p = plate[i]!
    const o = original[i]!
    sp += p
    so += o
    spp += p * p
    spo += p * o
    count++
  }
  const out = new Uint16Array(plate.length)
  const denom = count * spp - sp * sp
  if (count < 16 || Math.abs(denom) < 1e-6) {
    out.set(plate)
    return out
  }
  const a = (count * spo - sp * so) / denom
  const b = (so - a * sp) / count
  for (let i = 0; i < plate.length; i++) out[i] = Math.max(0, Math.min(65535, Math.round(a * plate[i]! + b)))
  return out
}

/** Median disparity (0..1) of depth pixels inside the actors — or one actor (sampled on the depth grid). */
export function actorDisparity(depth: Uint16Array, dw: number, dh: number, labels: Uint8Array, lw: number, lh: number, label?: number): number {
  const values: number[] = []
  const step = Math.max(1, Math.floor(Math.sqrt((dw * dh) / 30_000)))
  for (let y = 0; y < dh; y += step) {
    for (let x = 0; x < dw; x += step) {
      const lx = Math.min(lw - 1, Math.floor(((x + 0.5) / dw) * lw))
      const ly = Math.min(lh - 1, Math.floor(((y + 0.5) / dh) * lh))
      const l = labels[ly * lw + lx]!
      if (label === undefined ? l : l === label) values.push(depth[y * dw + x]!)
    }
  }
  if (values.length === 0) return 0.5
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]! / 65535
}

/** Nearest-neighbor resample of a Uint8 map (labels must not be interpolated). */
export function resampleNearest(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh)
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) / dh) * sh))
    for (let x = 0; x < dw; x++) out[y * dw + x] = src[sy * sw + Math.min(sw - 1, Math.floor(((x + 0.5) / dw) * sw))]!
  }
  return out
}

/** Box-blur a 0/1 mask (two passes ≈ a tent filter) into soft 0..255 edges, so effects fade in instead of cutting. */
export function featherMask(mask: Uint8Array, width: number, height: number, radius = 3): Uint8Array {
  let src = Float32Array.from(mask, (v) => v * 255)
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(src.length)
    for (let y = 0; y < height; y++) {
      let acc = 0
      for (let x = -radius; x <= radius; x++) acc += src[y * width + Math.min(width - 1, Math.max(0, x))]!
      for (let x = 0; x < width; x++) {
        tmp[y * width + x] = acc / (radius * 2 + 1)
        acc += src[y * width + Math.min(width - 1, x + radius + 1)]! - src[y * width + Math.max(0, x - radius)]!
      }
    }
    const out = new Float32Array(src.length)
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(height - 1, Math.max(0, y)) * width + x]!
      for (let y = 0; y < height; y++) {
        out[y * width + x] = acc / (radius * 2 + 1)
        acc += tmp[Math.min(height - 1, y + radius + 1) * width + x]! - tmp[Math.max(0, y - radius) * width + x]!
      }
    }
    src = out
  }
  return Uint8Array.from(src, (v) => Math.round(v))
}

/**
 * Disparity of the ground where an actor stands: the clean plate's depth just
 * above its contact point (the plate shows the ground there, not the actor).
 */
export function groundDepth(plateDepth: Uint16Array, dw: number, dh: number, anchor: [number, number]): number {
  const values: number[] = []
  const cy = anchor[1] - 0.012
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = Math.min(dw - 1, Math.max(0, Math.round(anchor[0] * dw) + dx))
      const y = Math.min(dh - 1, Math.max(0, Math.round(cy * dh) + dy))
      values.push(plateDepth[y * dw + x]!)
    }
  }
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]! / 65535
}
