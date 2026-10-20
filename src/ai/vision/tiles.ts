/**
 * Tiling for fixed-size image models (the ×2 upscaler takes exactly 512×512).
 * Tiles overlap and are blended with linear ramps across the overlap, so tile
 * seams never show; pictures smaller than a tile are edge-padded.
 */

export interface Tile {
  /** Top-left in the source picture (pixels). */
  x: number
  y: number
}

/** Tile origins covering `length` with tiles of `size` overlapping by at least `overlap`. */
export function tileStarts(length: number, size: number, overlap: number): number[] {
  if (length <= size) return [0]
  const step = size - overlap
  const count = Math.ceil((length - overlap) / step)
  // Spread the tiles evenly so the last one ends exactly at the edge.
  return Array.from({ length: count }, (_, i) => Math.round((i * (length - size)) / (count - 1)))
}

export function tileGrid(width: number, height: number, size = 512, overlap = 48): Tile[] {
  const xs = tileStarts(width, size, overlap)
  const ys = tileStarts(height, size, overlap)
  return ys.flatMap((y) => xs.map((x) => ({ x, y })))
}

/**
 * Blend weight of a pixel at offset `p` inside a tile of `size` that starts at
 * `start` in a picture of `length`: 1 in the interior, ramping toward the tile's
 * edges only where a neighbouring tile overlaps (never at the picture's edges).
 */
export function rampWeight(p: number, start: number, size: number, length: number, ramp: number): number {
  let w = 1
  if (start > 0 && p < ramp) w = Math.min(w, (p + 0.5) / ramp)
  const end = start + size
  if (end < length && p > size - 1 - ramp) w = Math.min(w, (size - p - 0.5) / ramp)
  return Math.max(1e-3, w)
}
