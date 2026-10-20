/**
 * The renderer draws a frame of a project onto any 2D canvas context. It runs
 * unchanged on the main thread (preview) and inside a worker (export), so it
 * only touches APIs available in both: canvas 2D, ImageBitmap, VideoFrame,
 * OffscreenCanvas.
 */
import type { DepthAnalysis } from '@/storage/db'

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

export interface SourceImage {
  source: CanvasImageSource
  width: number
  height: number
}

/**
 * Where the renderer gets pixels from. Preview and export provide different
 * implementations (media elements vs. decoded frames) behind this interface.
 * Returning null means "not available yet" (preview shows a placeholder).
 */
export interface FrameSources {
  image(assetId: string): SourceImage | null
  videoFrame(sceneId: string, assetId: string, sourceTime: number): SourceImage | null
  /** Duration of a video asset in seconds, if known. */
  videoDuration(assetId: string): number | undefined
  /** Depth analysis for an image asset (enables cinematic 3D motion), if computed. */
  depth(assetId: string): DepthAnalysis | null
}

export type CanvasFactory = (width: number, height: number) => AnyCanvas

export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function get2d(canvas: AnyCanvas): Ctx2D {
  const ctx = canvas.getContext('2d', { alpha: false }) as Ctx2D | null
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.')
  return ctx
}
