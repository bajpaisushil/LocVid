export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Round to a fixed number of decimals, avoiding float noise like 0.30000000000000004. */
export function roundTo(value: number, decimals = 3): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

/** Small deterministic PRNG (mulberry32); same seed → same sequence in preview and export. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
