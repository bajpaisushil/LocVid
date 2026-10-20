import type { GeneratedBackground } from '@/core/types'
import { createRng } from '@/lib/math'
import type { Ctx2D } from './types'

/**
 * Procedural scene backgrounds. Every style is a pure function of
 * (style, colors, seed, time), so preview and export are pixel-identical
 * and nothing needs to be stored besides the settings.
 */

function color(bg: GeneratedBackground, i: number): string {
  return bg.colors[i % bg.colors.length] ?? '#4f46e5'
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function linear(ctx: Ctx2D, bg: GeneratedBackground, w: number, h: number, t: number) {
  const angle = ((bg.angle + (bg.animate ? t * 6 : 0)) * Math.PI) / 180
  const r = Math.hypot(w, h) / 2
  const dx = Math.cos(angle) * r
  const dy = Math.sin(angle) * r
  const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy)
  const n = Math.max(2, bg.colors.length)
  for (let i = 0; i < n; i++) g.addColorStop(i / (n - 1), color(bg, i))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function radial(ctx: Ctx2D, bg: GeneratedBackground, w: number, h: number, t: number) {
  const drift = bg.animate ? Math.sin(t * 0.4) * 0.08 : 0
  const cx = w * (0.5 + drift)
  const cy = h * (0.45 - drift * 0.5)
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.65)
  g.addColorStop(0, color(bg, 0))
  g.addColorStop(1, color(bg, 1))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function aurora(ctx: Ctx2D, bg: GeneratedBackground, w: number, h: number, t: number) {
  ctx.fillStyle = '#05060f'
  ctx.fillRect(0, 0, w, h)
  const rng = createRng(bg.seed)
  const blobs = 5
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < blobs; i++) {
    const phase = rng() * Math.PI * 2
    const speed = 0.15 + rng() * 0.25
    const time = bg.animate ? t : 0
    const x = w * (0.5 + 0.38 * Math.sin(phase + time * speed))
    const y = h * (0.5 + 0.32 * Math.cos(phase * 1.3 + time * speed * 0.8))
    const radius = Math.max(w, h) * (0.28 + rng() * 0.22)
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
    g.addColorStop(0, withAlpha(color(bg, i), 0.55))
    g.addColorStop(1, withAlpha(color(bg, i), 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  ctx.restore()
}

function particles(ctx: Ctx2D, bg: GeneratedBackground, w: number, h: number, t: number) {
  linear(ctx, { ...bg, animate: false }, w, h, 0)
  const rng = createRng(bg.seed)
  const count = 70
  const short = Math.min(w, h)
  ctx.save()
  for (let i = 0; i < count; i++) {
    const x0 = rng()
    const y0 = rng()
    const size = (0.002 + rng() * 0.006) * short
    const speed = 0.02 + rng() * 0.05
    const alpha = 0.25 + rng() * 0.55
    const time = bg.animate ? t : 0
    const y = (((y0 - time * speed) % 1) + 1) % 1
    const x = x0 + Math.sin(time * 0.6 + i) * 0.01
    ctx.globalAlpha = alpha
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x * w, y * h, size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function grid(ctx: Ctx2D, bg: GeneratedBackground, w: number, h: number, t: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#05010f')
  sky.addColorStop(0.55, color(bg, 0))
  sky.addColorStop(1, '#05010f')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)
  const horizon = h * 0.55
  ctx.save()
  ctx.strokeStyle = withAlpha(color(bg, 1), 0.7)
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.003)
  const lines = 14
  const offset = bg.animate ? (t * 0.35) % 1 : 0
  for (let i = 0; i < lines; i++) {
    const p = (i + offset) / lines
    const y = horizon + (h - horizon) * p * p
    ctx.globalAlpha = Math.min(1, p * 1.5)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  ctx.globalAlpha = 0.6
  const verticals = 18
  for (let i = -verticals; i <= verticals; i++) {
    ctx.beginPath()
    ctx.moveTo(w / 2 + (i / verticals) * w * 0.08, horizon)
    ctx.lineTo(w / 2 + (i / verticals) * w * 1.6, h)
    ctx.stroke()
  }
  ctx.restore()
}

function waves(ctx: Ctx2D, bg: GeneratedBackground, w: number, h: number, t: number) {
  ctx.fillStyle = color(bg, 1)
  ctx.fillRect(0, 0, w, h)
  const rng = createRng(bg.seed)
  const layers = 4
  for (let l = 0; l < layers; l++) {
    const amp = h * (0.03 + rng() * 0.04)
    const freq = 1.5 + rng() * 2
    const phase = rng() * Math.PI * 2
    const speed = (0.3 + rng() * 0.4) * (l % 2 ? 1 : -1)
    const base = h * (0.45 + l * 0.12)
    const time = bg.animate ? t : 0
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += Math.max(4, w / 120)) {
      const y = base + Math.sin((x / w) * Math.PI * 2 * freq + phase + time * speed) * amp
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = withAlpha(color(bg, 0), 0.25 + l * 0.15)
    ctx.fill()
  }
}

function bokeh(ctx: Ctx2D, bg: GeneratedBackground, w: number, h: number, t: number) {
  radial(ctx, { ...bg, animate: false }, w, h, 0)
  const rng = createRng(bg.seed)
  const short = Math.min(w, h)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 26; i++) {
    const x0 = rng()
    const y0 = rng()
    const r = (0.03 + rng() * 0.09) * short
    const time = bg.animate ? t : 0
    const x = (x0 + Math.sin(time * 0.15 + i) * 0.03) * w
    const y = (y0 + Math.cos(time * 0.12 + i * 1.7) * 0.03) * h
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const c = i % 3 === 0 ? '#ffffff' : color(bg, i)
    g.addColorStop(0, withAlpha(c.startsWith('#') && c.length === 7 ? c : '#ffffff', 0.22 + rng() * 0.2))
    g.addColorStop(0.8, withAlpha(c.startsWith('#') && c.length === 7 ? c : '#ffffff', 0.08))
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawGenerated(ctx: Ctx2D, bg: GeneratedBackground, w: number, h: number, time: number): void {
  switch (bg.style) {
    case 'solid':
      ctx.fillStyle = color(bg, 0)
      ctx.fillRect(0, 0, w, h)
      return
    case 'linear':
      return linear(ctx, bg, w, h, time)
    case 'radial':
      return radial(ctx, bg, w, h, time)
    case 'aurora':
      return aurora(ctx, bg, w, h, time)
    case 'particles':
      return particles(ctx, bg, w, h, time)
    case 'grid':
      return grid(ctx, bg, w, h, time)
    case 'waves':
      return waves(ctx, bg, w, h, time)
    case 'bokeh':
      return bokeh(ctx, bg, w, h, time)
  }
}
