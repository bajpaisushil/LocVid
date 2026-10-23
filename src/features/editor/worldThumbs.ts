import { create } from 'zustand'
import type { WorldBackground } from '@/core/types'
import { worldKey, WorldRenderer } from '@/world/WorldRenderer'

/**
 * Real frames of live 3D shots for the timeline: the middle of each shot,
 * rendered off-screen in idle time and cached as small JPEGs. Components read
 * `useWorldThumbs` to re-render when new thumbnails arrive.
 */

export const useWorldThumbs = create<{ version: number }>(() => ({ version: 0 }))

const cache = new Map<string, string>()
const queued = new Map<string, { bg: WorldBackground; duration: number; aspect: number }>()
let renderer: WorldRenderer | null | undefined
let scheduled = false

const keyOf = (bg: WorldBackground, duration: number, aspect: number) => `${worldKey(bg.world)}|${bg.shot}|${bg.start}|${duration}|${aspect.toFixed(3)}`

function schedule() {
  if (scheduled) return
  scheduled = true
  const run = () => {
    scheduled = false
    const next = queued.entries().next()
    if (next.done) return
    const [key, job] = next.value
    queued.delete(key)
    try {
      renderer ??= WorldRenderer.create((w, h) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        return c
      })
      if (renderer) {
        const height = 144
        const width = Math.round(height * job.aspect)
        const canvas = renderer.render({ width, height, background: job.bg, time: job.duration * 0.5, duration: job.duration }) as HTMLCanvasElement
        cache.set(key, canvas.toDataURL('image/jpeg', 0.82))
        useWorldThumbs.setState((s) => ({ version: s.version + 1 }))
      }
    } catch {
      // A thumbnail is a nicety: leave the placeholder.
    }
    if (queued.size) schedule()
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 500 })
  else setTimeout(run, 30)
}

/** The cached thumbnail (data URL) of a 3D shot, or null while it renders. */
export function worldThumb(bg: WorldBackground, duration: number, aspect: number): string | null {
  const key = keyOf(bg, duration, aspect)
  const hit = cache.get(key)
  if (hit) return hit
  if (!queued.has(key)) {
    queued.set(key, { bg, duration, aspect })
    schedule()
  }
  return null
}

/** Sky-colored placeholder while a thumbnail renders. */
export function worldPlaceholder(bg: WorldBackground): string {
  const sky = { morning: '#ffd8b0', day: '#9fd0f2', sunset: '#ff9e6b', night: '#1d2c50' }[bg.world.time]
  const ground = { village: '#c9a26b', park: '#6fb04a', beach: '#ead6a6', city: '#9a9da2', snow: '#eef3f7' }[bg.world.place]
  return `linear-gradient(180deg, ${sky} 0%, ${sky} 55%, ${ground} 56%, ${ground} 100%)`
}
