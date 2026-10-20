import type { CropRect } from '@/core/types'
import { clamp } from '@/lib/math'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Destination rect that shows the whole source inside the frame (letterboxed). */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const scale = Math.min(dstW / srcW, dstH / srcH)
  const width = srcW * scale
  const height = srcH * scale
  return { x: (dstW - width) / 2, y: (dstH - height) / 2, width, height }
}

/** Destination rect that fills the frame, cropping the source's overflow equally on both sides. */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const scale = Math.max(dstW / srcW, dstH / srcH)
  const width = srcW * scale
  const height = srcH * scale
  return { x: (dstW - width) / 2, y: (dstH - height) / 2, width, height }
}

/**
 * Source-pixel rectangle to draw for "crop" mode: the largest rect with the
 * frame's aspect ratio inside the user's crop region, kept within the source.
 */
export function cropSourceRect(crop: CropRect, srcW: number, srcH: number, frameAspect: number): Rect {
  const cx = (crop.x + crop.width / 2) * srcW
  const cy = (crop.y + crop.height / 2) * srcH
  let w = crop.width * srcW
  let h = crop.height * srcH
  if (w / h > frameAspect) w = h * frameAspect
  else h = w / frameAspect
  w = Math.min(w, srcW)
  h = Math.min(h, srcH)
  return {
    x: clamp(cx - w / 2, 0, srcW - w),
    y: clamp(cy - h / 2, 0, srcH - h),
    width: Math.max(1, w),
    height: Math.max(1, h),
  }
}

/** UI model for crop: zoom (1 = whole frame-aspect area) and focal point (0..1). */
export interface CropControls {
  zoom: number
  focusX: number
  focusY: number
}

function baseSize(srcW: number, srcH: number, frameAspect: number) {
  return srcW / srcH > frameAspect
    ? { w: srcH * frameAspect, h: srcH }
    : { w: srcW, h: srcW / frameAspect }
}

export function cropFromControls(c: CropControls, srcW: number, srcH: number, frameAspect: number): CropRect {
  const base = baseSize(srcW, srcH, frameAspect)
  const zoom = clamp(c.zoom, 1, 8)
  const w = base.w / zoom
  const h = base.h / zoom
  const cx = w / 2 + clamp(c.focusX, 0, 1) * (srcW - w)
  const cy = h / 2 + clamp(c.focusY, 0, 1) * (srcH - h)
  return { x: (cx - w / 2) / srcW, y: (cy - h / 2) / srcH, width: w / srcW, height: h / srcH }
}

export function controlsFromCrop(crop: CropRect, srcW: number, srcH: number, frameAspect: number): CropControls {
  const r = cropSourceRect(crop, srcW, srcH, frameAspect)
  const base = baseSize(srcW, srcH, frameAspect)
  const zoom = clamp(base.w / r.width, 1, 8)
  const focusX = srcW - r.width > 1 ? r.x / (srcW - r.width) : 0.5
  const focusY = srcH - r.height > 1 ? r.y / (srcH - r.height) : 0.5
  return { zoom, focusX: clamp(focusX, 0, 1), focusY: clamp(focusY, 0, 1) }
}

/**
 * A frame-aspect crop (normalized) of `zoom`× magnification centered as close
 * to `center` (normalized) as the image allows — used to frame shots from a
 * single photo (wide, medium, close-up) around its subject.
 */
export function cropAround(center: { x: number; y: number }, zoom: number, srcW: number, srcH: number, frameAspect: number): CropRect {
  const base = baseSize(srcW, srcH, frameAspect)
  const w = base.w / Math.max(1, zoom)
  const h = base.h / Math.max(1, zoom)
  const cx = clamp(center.x * srcW, w / 2, srcW - w / 2)
  const cy = clamp(center.y * srcH, h / 2, srcH - h / 2)
  return { x: (cx - w / 2) / srcW, y: (cy - h / 2) / srcH, width: w / srcW, height: h / srcH }
}
