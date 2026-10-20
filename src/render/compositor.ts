import { frameAt, motionProgress, videoSourceTime, type Timeline, type TimelineEntry } from '@/core/timeline'
import type { MediaBackground, Project, TransitionType } from '@/core/types'
import { hashString } from '@/lib/id'
import { clamp } from '@/lib/math'
import { ease } from './easing'
import { containRect, coverRect, cropSourceRect, type Rect } from './fit'
import { drawGenerated } from './generated'
import { applyCamera, cameraAt, parallaxCameras, type Camera } from './motion'
import { drawOverlay } from './text'
import { get2d, type AnyCanvas, type CanvasFactory, type Ctx2D, type FrameSources, type SourceImage } from './types'

export interface FrameInput {
  project: Project
  timeline: Timeline
  sources: FrameSources
}

export interface RenderOptions {
  /** Draw a visible "loading/missing" placeholder for unavailable media (preview) instead of black (export). */
  placeholders?: boolean
}

/** Tiny canvas used for the cheap, portable blur (downscale → smooth upscale). Long side in px. */
const BLUR_RES = 40

/**
 * Draws project frames. One instance per output canvas; it owns the scratch
 * layers used for transitions and blurs. Pure function of (project, time,
 * sources): the preview and the exporter call exactly this code.
 */
export class Compositor {
  private layers: [AnyCanvas, Ctx2D][] = []
  private blur: [AnyCanvas, Ctx2D] | null = null

  private readonly createCanvas: CanvasFactory

  constructor(createCanvas: CanvasFactory) {
    this.createCanvas = createCanvas
  }

  private layer(index: number, w: number, h: number): Ctx2D {
    let entry = this.layers[index]
    if (!entry || entry[0].width !== w || entry[0].height !== h) {
      const canvas = this.createCanvas(w, h)
      entry = [canvas, get2d(canvas)]
      this.layers[index] = entry
    }
    return entry[1]
  }

  private blurCtx(w: number, h: number): Ctx2D {
    const scale = BLUR_RES / Math.max(w, h)
    const bw = Math.max(1, Math.round(w * scale))
    const bh = Math.max(1, Math.round(h * scale))
    if (!this.blur || this.blur[0].width !== bw || this.blur[0].height !== bh) {
      const canvas = this.createCanvas(bw, bh)
      this.blur = [canvas, get2d(canvas)]
    }
    return this.blur[1]
  }

  dispose(): void {
    for (const [canvas] of this.layers) {
      canvas.width = 0
      canvas.height = 0
    }
    this.layers = []
    this.blur = null
  }

  render(ctx: Ctx2D, width: number, height: number, input: FrameInput, time: number, options: RenderOptions = {}): void {
    const { plan, fade } = frameAt(input.timeline, time)
    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (plan.kind === 'empty') {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
    } else if (plan.kind === 'scene') {
      this.renderScene(ctx, plan.entry, plan.localTime, width, height, input, options)
    } else {
      const a = this.layer(0, width, height)
      const b = this.layer(1, width, height)
      this.renderScene(a, plan.from, plan.fromLocal, width, height, input, options)
      this.renderScene(b, plan.to, plan.toLocal, width, height, input, options)
      composite(ctx, plan.type, plan.progress, a.canvas, b.canvas, width, height)
    }
    this.drawLogo(ctx, width, height, input)
    if (fade && fade.alpha > 0) {
      ctx.globalAlpha = clamp(fade.alpha, 0, 1)
      ctx.fillStyle = fade.color === 'white' ? '#fff' : '#000'
      ctx.fillRect(0, 0, width, height)
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }

  private renderScene(
    ctx: Ctx2D,
    entry: TimelineEntry,
    localTime: number,
    w: number,
    h: number,
    input: FrameInput,
    options: RenderOptions,
  ): void {
    const { scene } = entry
    ctx.save()
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    const bg = scene.background
    if (bg.kind === 'generated') {
      drawGenerated(ctx, bg, w, h, localTime + entry.inDuration / 2)
    } else {
      const source = this.mediaFor(entry, bg, localTime, input.sources)
      if (source) this.drawMedia(ctx, entry, bg, source, localTime, w, h)
      else if (options.placeholders) drawPlaceholder(ctx, w, h)
    }
    for (const overlay of scene.overlays) drawOverlay(ctx, overlay, entry, localTime, w, h)
    ctx.restore()
  }

  private mediaFor(entry: TimelineEntry, bg: MediaBackground, localTime: number, sources: FrameSources): SourceImage | null {
    const duration = sources.videoDuration(bg.assetId)
    if (duration === undefined) {
      const image = sources.image(bg.assetId)
      if (image) return image
    }
    const sourceTime = videoSourceTime(entry, localTime, bg.trimStart, duration, bg.loop)
    return sources.videoFrame(entry.scene.id, bg.assetId, sourceTime) ?? sources.image(bg.assetId)
  }

  private drawMedia(
    ctx: Ctx2D,
    entry: TimelineEntry,
    bg: MediaBackground,
    src: SourceImage,
    localTime: number,
    w: number,
    h: number,
  ): void {
    const { scene } = entry
    const progress = motionProgress(entry, localTime)
    const seed = hashString(scene.id)

    if (scene.motion.preset === 'parallax') {
      const { back, front } = parallaxCameras(scene.motion, progress, seed)
      this.drawBlurred(ctx, src, w, h, back)
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.fillRect(0, 0, w, h)
      const short = Math.min(w, h)
      const inset = containRect(src.width, src.height, w * 0.84, h * 0.84)
      const card = applyCamera({ ...inset, x: inset.x + w * 0.08, y: inset.y + h * 0.08 }, front, w, h)
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = short * 0.05
      ctx.shadowOffsetY = short * 0.015
      roundedClip(ctx, card, short * 0.02)
      ctx.fillStyle = '#000'
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.clip()
      ctx.drawImage(src.source, card.x, card.y, card.width, card.height)
      ctx.restore()
      return
    }

    const camera = cameraAt(scene.motion, progress, seed)
    if (bg.fit === 'crop') {
      const s = cropSourceRect(bg.crop, src.width, src.height, w / h)
      const d = applyCamera({ x: 0, y: 0, width: w, height: h }, camera, w, h)
      drawSub(ctx, src, s, d)
      return
    }
    if (bg.fit === 'contain') {
      if (bg.fill === 'blur') {
        this.drawBlurred(ctx, src, w, h, { scale: 1.1, x: 0, y: 0 })
        ctx.fillStyle = 'rgba(0,0,0,0.3)'
        ctx.fillRect(0, 0, w, h)
      } else if (bg.fill === 'color') {
        ctx.fillStyle = bg.fillColor
        ctx.fillRect(0, 0, w, h)
      }
      const rect = applyCamera(containRect(src.width, src.height, w, h), camera, w, h)
      ctx.drawImage(src.source, rect.x, rect.y, rect.width, rect.height)
      return
    }
    const rect = applyCamera(coverRect(src.width, src.height, w, h), camera, w, h)
    ctx.drawImage(src.source, rect.x, rect.y, rect.width, rect.height)
  }

  /** Portable blur: draw tiny, then upscale with smoothing. Works in workers and every browser. */
  private drawBlurred(ctx: Ctx2D, src: SourceImage, w: number, h: number, camera: Camera): void {
    const tiny = this.blurCtx(w, h)
    const tw = tiny.canvas.width
    const th = tiny.canvas.height
    tiny.imageSmoothingEnabled = true
    tiny.imageSmoothingQuality = 'low'
    const r = coverRect(src.width, src.height, tw, th)
    tiny.drawImage(src.source, r.x, r.y, r.width, r.height)
    const d = applyCamera({ x: 0, y: 0, width: w, height: h }, camera, w, h)
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(tiny.canvas, d.x, d.y, d.width, d.height)
    ctx.restore()
  }

  private drawLogo(ctx: Ctx2D, w: number, h: number, input: FrameInput): void {
    const { brand } = input.project
    if (!brand.logoAssetId || brand.opacity <= 0) return
    const logo = input.sources.image(brand.logoAssetId)
    if (!logo) return
    const short = Math.min(w, h)
    const lh = brand.size * short
    const lw = (logo.width / logo.height) * lh
    const margin = short * 0.04
    const x = brand.position.endsWith('left') ? margin : w - margin - lw
    const y = brand.position.startsWith('top') ? margin : h - margin - lh
    ctx.save()
    ctx.globalAlpha = clamp(brand.opacity, 0, 1)
    ctx.drawImage(logo.source, x, y, lw, lh)
    ctx.restore()
  }
}

function drawSub(ctx: Ctx2D, src: SourceImage, s: Rect, d: Rect) {
  ctx.drawImage(src.source, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height)
}

function roundedClip(ctx: Ctx2D, r: Rect, radius: number) {
  ctx.beginPath()
  if ('roundRect' in ctx) ctx.roundRect(r.x, r.y, r.width, r.height, radius)
  else (ctx as Ctx2D).rect(r.x, r.y, r.width, r.height)
}

function drawPlaceholder(ctx: Ctx2D, w: number, h: number) {
  ctx.fillStyle = '#16161d'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = Math.max(1, w / 160)
  for (let x = -h; x < w; x += w / 16) {
    ctx.beginPath()
    ctx.moveTo(x, h)
    ctx.lineTo(x + h, 0)
    ctx.stroke()
  }
}

/** Blend two fully rendered scene layers. `p` runs 0 → 1 across the transition. */
export function composite(
  ctx: Ctx2D,
  type: TransitionType,
  p: number,
  a: CanvasImageSource,
  b: CanvasImageSource,
  w: number,
  h: number,
): void {
  const e = ease.easeInOut(clamp(p, 0, 1))
  switch (type) {
    case 'none':
      ctx.drawImage(p < 0.5 ? a : b, 0, 0, w, h)
      return
    case 'crossfade':
      ctx.drawImage(a, 0, 0, w, h)
      ctx.globalAlpha = ease.smooth(p)
      ctx.drawImage(b, 0, 0, w, h)
      ctx.globalAlpha = 1
      return
    case 'fadeBlack':
    case 'fadeWhite': {
      ctx.drawImage(p < 0.5 ? a : b, 0, 0, w, h)
      ctx.globalAlpha = p < 0.5 ? ease.smooth(p * 2) : ease.smooth((1 - p) * 2)
      ctx.fillStyle = type === 'fadeWhite' ? '#fff' : '#000'
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 1
      return
    }
    case 'slideLeft':
      ctx.drawImage(a, -e * w, 0, w, h)
      ctx.drawImage(b, (1 - e) * w, 0, w, h)
      return
    case 'slideRight':
      ctx.drawImage(a, e * w, 0, w, h)
      ctx.drawImage(b, -(1 - e) * w, 0, w, h)
      return
    case 'slideUp':
      ctx.drawImage(a, 0, -e * h, w, h)
      ctx.drawImage(b, 0, (1 - e) * h, w, h)
      return
    case 'slideDown':
      ctx.drawImage(a, 0, e * h, w, h)
      ctx.drawImage(b, 0, -(1 - e) * h, w, h)
      return
    case 'wipeLeft':
    case 'wipeRight': {
      ctx.drawImage(a, 0, 0, w, h)
      const edge = type === 'wipeLeft' ? w * (1 - e) : 0
      const width = w * e
      ctx.save()
      ctx.beginPath()
      ctx.rect(edge, 0, width, h)
      ctx.clip()
      ctx.drawImage(b, 0, 0, w, h)
      ctx.restore()
      return
    }
    case 'zoom': {
      const sb = 1.12 - 0.12 * e
      ctx.drawImage(b, (w - w * sb) / 2, (h - h * sb) / 2, w * sb, h * sb)
      const sa = 1 + 0.25 * e
      ctx.globalAlpha = 1 - ease.smooth(p)
      ctx.drawImage(a, (w - w * sa) / 2, (h - h * sa) / 2, w * sa, h * sa)
      ctx.globalAlpha = 1
      return
    }
  }
}
