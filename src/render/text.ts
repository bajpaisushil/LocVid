import { overlayTiming, type TimelineEntry } from '@/core/timeline'
import type { TextAnimation, TextOverlay } from '@/core/types'
import { clamp } from '@/lib/math'
import { ease } from './easing'
import { canvasFont } from './fonts'
import type { Ctx2D } from './types'

/**
 * Text overlays. Sizes are relative to the frame's short side so a caption
 * reads the same in 16:9, 9:16 and 1:1, and in a 640 px preview or a 1080p export.
 */

export interface TextLayout {
  lines: string[]
  lineWidths: number[]
  fontPx: number
  lineHeightPx: number
  blockWidth: number
  blockHeight: number
  font: string
}

const layoutCache = new Map<string, TextLayout>()
const LAYOUT_CACHE_LIMIT = 400

function supportsLetterSpacing(ctx: Ctx2D): boolean {
  return 'letterSpacing' in ctx
}

function wrapParagraph(ctx: Ctx2D, paragraph: string, maxWidth: number): string[] {
  const words = paragraph.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let line = ''
  const push = (l: string) => lines.push(l)
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      if (!line && ctx.measureText(word).width > maxWidth) {
        // A single word wider than the box: break it by characters.
        let chunk = ''
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
            push(chunk)
            chunk = ch
          } else chunk += ch
        }
        line = chunk
      } else {
        line = candidate
      }
    } else {
      push(line)
      line = word
    }
  }
  push(line)
  return lines
}

export function layoutText(ctx: Ctx2D, overlay: TextOverlay, frameW: number, frameH: number): TextLayout {
  const short = Math.min(frameW, frameH)
  const fontPx = Math.max(4, overlay.fontSize * short)
  const font = canvasFont(overlay.fontFamily, overlay.fontWeight, fontPx)
  const maxWidth = Math.max(fontPx, overlay.maxWidth * frameW)
  const text = overlay.uppercase ? overlay.text.toUpperCase() : overlay.text
  const spacing = overlay.letterSpacing * fontPx
  const key = `${font}|${maxWidth.toFixed(1)}|${spacing.toFixed(2)}|${overlay.lineHeight}|${text}`
  const cached = layoutCache.get(key)
  if (cached) return cached

  ctx.save()
  ctx.font = font
  if (supportsLetterSpacing(ctx)) (ctx as CanvasRenderingContext2D).letterSpacing = `${spacing}px`
  const lines = text.split(/\r?\n/).flatMap((p) => wrapParagraph(ctx, p, maxWidth))
  const lineWidths = lines.map((l) => ctx.measureText(l).width)
  ctx.restore()

  const lineHeightPx = fontPx * overlay.lineHeight
  const layout: TextLayout = {
    lines,
    lineWidths,
    fontPx,
    lineHeightPx,
    blockWidth: Math.max(0, ...lineWidths),
    blockHeight: lines.length * lineHeightPx,
    font,
  }
  if (layoutCache.size >= LAYOUT_CACHE_LIMIT) layoutCache.delete(layoutCache.keys().next().value!)
  layoutCache.set(key, layout)
  return layout
}

/** Axis-aligned box of an overlay's text block in frame pixels (used for hit-testing in the preview). */
export function overlayBox(ctx: Ctx2D, overlay: TextOverlay, frameW: number, frameH: number) {
  const layout = layoutText(ctx, overlay, frameW, frameH)
  const pad = overlay.background.enabled ? overlay.background.padding * layout.fontPx : 0
  const anchorX = overlay.x * frameW
  const left =
    overlay.align === 'left' ? anchorX : overlay.align === 'right' ? anchorX - layout.blockWidth : anchorX - layout.blockWidth / 2
  const top = overlay.y * frameH - layout.blockHeight / 2
  return {
    x: left - pad,
    y: top - pad,
    width: layout.blockWidth + pad * 2,
    height: layout.blockHeight + pad * 2,
    layout,
  }
}

interface AnimState {
  alpha: number
  dy: number
  scale: number
  /** Fraction of characters (typewriter) or words (wordByWord) revealed. */
  reveal: number
  revealMode: 'none' | 'chars' | 'words'
}

function animate(kind: TextAnimation, t: number, entering: boolean, short: number): Partial<AnimState> {
  const p = ease.easeOut(t)
  switch (kind) {
    case 'none':
      return {}
    case 'fade':
      return { alpha: p }
    case 'slideUp':
      return { alpha: p, dy: (1 - p) * short * 0.06 * (entering ? 1 : -1) }
    case 'slideDown':
      return { alpha: p, dy: (1 - p) * short * 0.06 * (entering ? -1 : 1) }
    case 'pop':
      return entering ? { alpha: ease.easeOut(clamp(t * 1.6, 0, 1)), scale: 0.6 + 0.4 * ease.backOut(t) } : { alpha: p, scale: 0.85 + 0.15 * p }
    case 'typewriter':
      return entering ? { reveal: t, revealMode: 'chars' } : { alpha: p }
    case 'wordByWord':
      return entering ? { reveal: t, revealMode: 'words' } : { alpha: p }
  }
}

function animationState(overlay: TextOverlay, entry: TimelineEntry, localTime: number, short: number): AnimState | null {
  const timing = overlayTiming(overlay, entry)
  if (localTime < timing.start || localTime >= timing.end) return null
  const state: AnimState = { alpha: 1, dy: 0, scale: 1, reveal: 1, revealMode: 'none' }
  // Typewriter/word reveals take longer than a fade: scale with text length.
  const revealSpan =
    overlay.animationIn === 'typewriter'
      ? Math.min((timing.end - Math.max(0, timing.start)) * 0.7, overlay.text.length * 0.045)
      : overlay.animationIn === 'wordByWord'
        ? Math.min((timing.end - Math.max(0, timing.start)) * 0.7, overlay.text.split(/\s+/).length * 0.22)
        : timing.animIn
  if (overlay.animationIn !== 'none' && revealSpan > 0) {
    const t = clamp((localTime - Math.max(0, timing.start)) / revealSpan, 0, 1)
    Object.assign(state, animate(overlay.animationIn, t, true, short))
  }
  if (overlay.animationOut !== 'none' && timing.animOut > 0) {
    const t = clamp((timing.end - localTime) / timing.animOut, 0, 1)
    if (t < 1) {
      const out = animate(overlay.animationOut, t, false, short)
      state.alpha *= out.alpha ?? 1
      state.dy += out.dy ?? 0
      state.scale *= out.scale ?? 1
    }
  }
  return state.alpha > 0.001 ? state : null
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  if ('roundRect' in ctx) {
    ctx.roundRect(x, y, w, h, radius)
  } else {
    ;(ctx as Ctx2D).rect(x, y, w, h)
  }
}

function hexToRgba(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  let hex = m[1]!
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('')
  const n = parseInt(hex, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** Draw one overlay at a scene-local time. */
export function drawOverlay(
  ctx: Ctx2D,
  overlay: TextOverlay,
  entry: TimelineEntry,
  localTime: number,
  frameW: number,
  frameH: number,
): void {
  if (!overlay.text.trim()) return
  const short = Math.min(frameW, frameH)
  const anim = animationState(overlay, entry, localTime, short)
  if (!anim) return
  const box = overlayBox(ctx, overlay, frameW, frameH)
  const { layout } = box

  ctx.save()
  ctx.globalAlpha *= clamp(anim.alpha, 0, 1)
  // Offset by dy, scaling about the block's center: p → (p − c)·s + c + (0, dy).
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  ctx.translate(cx, cy + anim.dy)
  if (anim.scale !== 1) ctx.scale(anim.scale, anim.scale)
  ctx.translate(-cx, -cy)

  if (overlay.background.enabled) {
    ctx.fillStyle = hexToRgba(overlay.background.color, overlay.background.opacity)
    roundRect(ctx, box.x, box.y, box.width, box.height, overlay.background.radius * layout.fontPx)
    ctx.fill()
  }

  ctx.font = layout.font
  if (supportsLetterSpacing(ctx)) (ctx as CanvasRenderingContext2D).letterSpacing = `${overlay.letterSpacing * layout.fontPx}px`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  const pad = overlay.background.enabled ? overlay.background.padding * layout.fontPx : 0
  const top = box.y + pad
  const totalChars = layout.lines.reduce((n, l) => n + [...l].length, 0)
  const totalWords = layout.lines.reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0)
  let charBudget = anim.revealMode === 'chars' ? Math.floor(totalChars * anim.reveal) : Infinity
  let wordIndex = 0

  layout.lines.forEach((line, i) => {
    const lineWidth = layout.lineWidths[i]!
    const x =
      overlay.align === 'left'
        ? box.x + pad
        : overlay.align === 'right'
          ? box.x + box.width - pad - lineWidth
          : box.x + (box.width - lineWidth) / 2
    const y = top + i * layout.lineHeightPx + layout.lineHeightPx / 2

    if (anim.revealMode === 'words') {
      // Reveal word by word, each fading in quickly, keeping final positions stable.
      const words = line.split(/(\s+)/)
      let cursor = x
      for (const w of words) {
        const width = ctx.measureText(w).width
        if (w.trim()) {
          const wordStart = wordIndex / Math.max(1, totalWords)
          const local = clamp((anim.reveal - wordStart) * totalWords, 0, 1)
          if (local > 0) {
            ctx.save()
            ctx.globalAlpha *= local
            paintText(ctx, overlay, w, cursor, y, layout.fontPx)
            ctx.restore()
          }
          wordIndex++
        }
        cursor += width
      }
      return
    }

    let text = line
    if (charBudget !== Infinity) {
      const chars = [...line]
      text = chars.slice(0, Math.max(0, charBudget)).join('')
      charBudget -= chars.length
      if (!text) return
    }
    paintText(ctx, overlay, text, x, y, layout.fontPx)
  })
  ctx.restore()
}

function paintText(ctx: Ctx2D, overlay: TextOverlay, text: string, x: number, y: number, fontPx: number) {
  if (overlay.shadow.enabled) {
    ctx.shadowColor = overlay.shadow.color
    ctx.shadowBlur = overlay.shadow.blur * fontPx
    ctx.shadowOffsetY = fontPx * 0.04
  }
  if (overlay.outline.enabled && overlay.outline.width > 0) {
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.lineWidth = overlay.outline.width * fontPx * 2
    ctx.strokeStyle = overlay.outline.color
    ctx.strokeText(text, x, y)
    // Only the outline casts the shadow; the fill sits cleanly on top.
    ctx.shadowColor = 'transparent'
  }
  ctx.fillStyle = overlay.color
  ctx.fillText(text, x, y)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
}
