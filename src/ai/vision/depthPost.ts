/**
 * Post-processing of a depth model's output into what the cinematic renderer
 * needs. Depth Anything predicts relative *disparity* (larger = nearer), so:
 *  - normalize it to 0..65535 (16-bit keeps parallax smooth — 8-bit would band),
 *  - find the far region connected to the top edge (sky or distant scenery)
 *    for gentle "atmosphere" animation,
 *  - estimate the main subject's disparity, used as the camera pivot so the
 *    subject stays anchored while foreground and background move around it.
 */

export function normalizeDisparity(raw: Float32Array): Uint16Array {
  let min = Infinity
  let max = -Infinity
  for (const v of raw) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min || 1
  const out = new Uint16Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = Math.round(((raw[i]! - min) / range) * 65535)
  return out
}

/**
 * Flood fill from the top row through pixels farther than `threshold` (0..1
 * disparity) — and, when a texture map is given, smooth enough to be sky or
 * haze rather than distant buildings (which would visibly smear if drifted).
 */
export function farRegionMask(depth: Uint16Array, width: number, height: number, threshold = 0.06, texture?: Float32Array, maxTexture = 0.06): Uint8Array {
  const limit = threshold * 65535
  const mask = new Uint8Array(width * height)
  const stack: number[] = []
  const ok = (i: number) => depth[i]! <= limit && (!texture || texture[i]! <= maxTexture)
  for (let x = 0; x < width; x++) {
    if (ok(x)) {
      mask[x] = 1
      stack.push(x)
    }
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % width
    const y = (i - x) / width
    const neighbors = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]
    for (const n of neighbors) {
      if (n >= 0 && !mask[n] && ok(n)) {
        mask[n] = 1
        stack.push(n)
      }
    }
  }
  // Ignore tiny "far" specks: a real sky/backdrop covers a meaningful area.
  let count = 0
  for (const m of mask) count += m
  if (count < width * height * 0.02) mask.fill(0)
  return mask
}

/** 75th percentile of disparity in the central area — where the subject usually is. */
export function subjectDisparity(depth: Uint16Array, width: number, height: number): number {
  const values: number[] = []
  const x0 = Math.floor(width * 0.25)
  const x1 = Math.ceil(width * 0.75)
  const y0 = Math.floor(height * 0.2)
  const y1 = Math.ceil(height * 0.85)
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)))
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) values.push(depth[y * width + x]!)
  if (values.length === 0) return 0.5
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length * 0.75)]! / 65535
}

const multipleOf14 = (v: number) => Math.max(14, Math.round(v / 14) * 14)

/** Model input size: short side 518, aspect kept, multiple of 14, long side capped. */
export function depthInputSize(width: number, height: number, target = 518, maxLong = 924): { width: number; height: number } {
  const scale = target / Math.min(width, height)
  let w = width * scale
  let h = height * scale
  const long = Math.max(w, h)
  if (long > maxLong) {
    w *= maxLong / long
    h *= maxLong / long
  }
  return { width: multipleOf14(w), height: multipleOf14(h) }
}

// ---------------------------------------------------------------------------
// Layered depth: background behind foreground edges
// ---------------------------------------------------------------------------

/** Separable sliding-window max and min over a (2r+1)² square. */
export function maxMinFilter(src: Uint16Array, width: number, height: number, r: number): { max: Uint16Array; min: Uint16Array } {
  const pass = (input: Uint16Array, horizontal: boolean, pick: (a: number, b: number) => number) => {
    const out = new Uint16Array(input.length)
    const n = horizontal ? width : height
    const lines = horizontal ? height : width
    for (let line = 0; line < lines; line++) {
      for (let i = 0; i < n; i++) {
        let v = horizontal ? input[line * width + i]! : input[i * width + line]!
        for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) {
          v = pick(v, horizontal ? input[line * width + k]! : input[k * width + line]!)
        }
        if (horizontal) out[line * width + i] = v
        else out[i * width + line] = v
      }
    }
    return out
  }
  return {
    max: pass(pass(src, true, Math.max), false, Math.max),
    min: pass(pass(src, true, Math.min), false, Math.min),
  }
}

/**
 * Pixels on the *near* side of a strong depth discontinuity (within r px).
 * When the camera moves, these occluders slide off what's behind them; the
 * background layer has them removed and filled in.
 */
export function occluderMask(depth: Uint16Array, width: number, height: number, r = 12, jump = 0.12): Uint8Array {
  const { max, min } = maxMinFilter(depth, width, height, r)
  const mask = new Uint8Array(depth.length)
  const jumpLimit = jump * 65535
  for (let i = 0; i < depth.length; i++) {
    const lo = min[i]!
    const hi = max[i]!
    if (hi - lo > jumpLimit && depth[i]! > (lo + hi) / 2) mask[i] = 1
  }
  return mask
}

/**
 * Push–pull fill: holes (weight 0) are filled with a smooth blend of the
 * surrounding valid values, coarse-to-fine — a fast, dependency-free inpainting
 * that is ideal for revealing soft background behind a moving subject.
 */
export function pushPullFill(values: Float32Array, channels: number, width: number, height: number, valid: Uint8Array): Float32Array {
  const levels: { v: Float32Array; w: Float32Array; width: number; height: number }[] = []
  let v = values.slice()
  let w = Float32Array.from(valid)
  let lw = width
  let lh = height
  for (let i = 0; i < v.length / channels; i++) if (!w[i]) for (let c = 0; c < channels; c++) v[i * channels + c] = 0
  levels.push({ v, w, width: lw, height: lh })
  while (lw > 1 || lh > 1) {
    const nw = Math.max(1, Math.ceil(lw / 2))
    const nh = Math.max(1, Math.ceil(lh / 2))
    const nv = new Float32Array(nw * nh * channels)
    const nwt = new Float32Array(nw * nh)
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sumW = 0
        const acc = new Float64Array(channels)
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(lw - 1, x * 2 + dx)
            const sy = Math.min(lh - 1, y * 2 + dy)
            const si = sy * lw + sx
            const wt = w[si]!
            sumW += wt
            for (let c = 0; c < channels; c++) acc[c] = acc[c]! + v[si * channels + c]! * wt
          }
        }
        const di = y * nw + x
        if (sumW > 0) for (let c = 0; c < channels; c++) nv[di * channels + c] = acc[c]! / sumW
        nwt[di] = Math.min(1, sumW)
      }
    }
    v = nv
    w = nwt
    lw = nw
    lh = nh
    levels.push({ v, w, width: lw, height: lh })
  }
  // Push: fill each level's gaps from the (already filled) coarser level, bilinearly.
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l]!
    const coarse = levels[l + 1]!
    for (let y = 0; y < fine.height; y++) {
      for (let x = 0; x < fine.width; x++) {
        const i = y * fine.width + x
        const wt = fine.w[i]!
        if (wt >= 1) continue
        const cx = Math.min(coarse.width - 1, Math.max(0, (x + 0.5) / 2 - 0.5))
        const cy = Math.min(coarse.height - 1, Math.max(0, (y + 0.5) / 2 - 0.5))
        const x0 = Math.floor(cx)
        const y0 = Math.floor(cy)
        const x1 = Math.min(coarse.width - 1, x0 + 1)
        const y1 = Math.min(coarse.height - 1, y0 + 1)
        const fx = cx - x0
        const fy = cy - y0
        for (let c = 0; c < channels; c++) {
          const a = coarse.v[(y0 * coarse.width + x0) * channels + c]!
          const b = coarse.v[(y0 * coarse.width + x1) * channels + c]!
          const d = coarse.v[(y1 * coarse.width + x0) * channels + c]!
          const e = coarse.v[(y1 * coarse.width + x1) * channels + c]!
          const up = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy
          fine.v[i * channels + c] = fine.v[i * channels + c]! * wt + up * (1 - wt)
        }
        fine.w[i] = 1
      }
    }
  }
  return levels[0]!.v
}

/** Luminance gradient magnitude (0..1) — texture detector used to keep the sky mask to smooth areas. */
export function luminanceGradient(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const lum = new Float32Array(width * height)
  for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!) / 255
  const out = new Float32Array(lum.length)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const gx = lum[i + 1]! - lum[i - 1]!
      const gy = lum[i + width]! - lum[i - width]!
      out[i] = Math.hypot(gx, gy)
    }
  }
  return out
}

export interface LayeredDepth {
  /** Background color behind occluders (RGBA8), at depth resolution. */
  fill: Uint8ClampedArray
  /** Background depth with occluders removed (Uint16). */
  bgDepth: Uint16Array
  /** 1 where the background layer differs from the original (occluder band). */
  hole: Uint8Array
}

export function layeredDepth(rgba: Uint8ClampedArray, depth: Uint16Array, width: number, height: number): LayeredDepth {
  const hole = occluderMask(depth, width, height)
  const valid = Uint8Array.from(hole, (h) => (h ? 0 : 1))
  const color = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) color[i * 3 + c] = rgba[i * 4 + c]!
  const filledColor = pushPullFill(color, 3, width, height, valid)
  const filledDepth = pushPullFill(Float32Array.from(depth), 1, width, height, valid)
  const fill = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) fill[i * 4 + c] = filledColor[i * 3 + c]!
    fill[i * 4 + 3] = 255
  }
  return { fill, bgDepth: Uint16Array.from(filledDepth, (d) => Math.round(d)), hole }
}

/**
 * Bounding box (normalized x, y, w, h) of the main subject: pixels near the
 * subject's depth plane or nearer, ignoring the bottom strip (usually ground
 * running toward the camera). Used to frame close-ups from a single photo.
 */
const quantile = (sorted: number[], f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))]!

export function subjectBox(depth: Uint16Array, width: number, height: number, subject: number): [number, number, number, number] {
  const limit = Math.max(0.05, subject - 0.06) * 65535
  const xs: number[] = []
  const ys: number[] = []
  const yMax = Math.floor(height * 0.9)
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 20000)))
  for (let y = 0; y < yMax; y += step) {
    for (let x = 0; x < width; x += step) {
      if (depth[y * width + x]! >= limit) {
        xs.push(x)
        ys.push(y)
      }
    }
  }
  if (xs.length < 20) return [0.25, 0.2, 0.5, 0.6]
  xs.sort((a, b) => a - b)
  ys.sort((a, b) => a - b)
  const x0 = quantile(xs, 0.08) / width
  const x1 = quantile(xs, 0.92) / width
  const y0 = quantile(ys, 0.06) / height
  const y1 = quantile(ys, 0.94) / height
  return [x0, y0, Math.max(0.05, x1 - x0), Math.max(0.05, y1 - y0)]
}
