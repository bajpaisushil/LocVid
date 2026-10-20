import { buildAudioPlan } from '@/core/audioPlan'
import { buildTimeline, frameAt, videoSourceTime, type Timeline, type TimelineEntry } from '@/core/timeline'
import type { AssetMeta, Project } from '@/core/types'
import { clamp } from '@/lib/math'
import { Compositor } from '@/render/compositor'
import { fontUsages, loadFonts } from '@/render/fonts'
import { get2d, type Ctx2D, type FrameSources, type SourceImage } from '@/render/types'
import type { AssetEntry } from '@/state/editorStore'
import { PreviewAudio } from './audioPlayer'
import { PreviewMediaCache } from './mediaCache'
import { getAnalyses } from '@/storage/repo'
import type { DepthAnalysis } from '@/storage/db'

interface VideoSlot {
  el: HTMLVideoElement
  assetId: string
  ready: boolean
  lastNeeded: number
}

/** How far ahead to warm up the next scene's video so the cut is seamless. */
const PRELOAD_AHEAD = 1.5
const DRIFT_TOLERANCE = 0.25

/**
 * Drives the live preview: renders frames with the shared Compositor, keeps
 * <video> elements in step with the timeline, and plays the audio plan.
 * Framework-agnostic; the React PreviewPanel wires it to the stores.
 */
export class PreviewEngine {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: Ctx2D
  private readonly compositor = new Compositor((w, h) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  })
  private readonly cache = new PreviewMediaCache()
  private readonly audio = new PreviewAudio(this.cache)
  private project: Project | null = null
  private assets: Record<string, AssetEntry> = {}
  private metas: Record<string, AssetMeta> = {}
  private timeline: Timeline = buildTimeline({ scenes: [], fadeOutEnd: 0 })
  private videos = new Map<string, VideoSlot>()
  /** Depth maps loaded from IndexedDB (null = none computed for that asset). */
  private depths = new Map<string, DepthAnalysis | null>()
  private depthLoading = new Set<string>()
  private time = 0
  private playing = false
  private raf = 0
  private renderQueued = false
  private clockStart = 0
  private clockOrigin = 0
  private disposed = false

  /** Called with the current time while playing. */
  onTime: (time: number) => void = () => {}
  /** Called when playback stops by itself (end of timeline). */
  onEnded: () => void = () => {}

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = get2d(canvas)
    this.cache.onReady = () => this.requestRender()
    document.fonts?.addEventListener('loadingdone', this.onFontsLoaded)
  }

  private onFontsLoaded = () => this.requestRender()

  get duration(): number {
    return this.timeline.duration
  }

  get context(): Ctx2D {
    return this.ctx
  }

  get canvasElement(): HTMLCanvasElement {
    return this.canvas
  }

  /** Canvas pixel size (the preview renders at screen resolution, capped). */
  get size(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height }
  }

  setInput(project: Project, assets: Record<string, AssetEntry>): void {
    const assetsChanged = assets !== this.assets
    this.project = project
    this.assets = assets
    if (assetsChanged) {
      this.metas = {}
      for (const [id, entry] of Object.entries(assets)) this.metas[id] = entry.meta
    }
    this.timeline = buildTimeline(project)
    this.audio.setPlan(buildAudioPlan(project, this.metas, this.timeline, { includeVideoAudio: false }))
    void loadFonts(fontUsages(project)).then(() => this.requestRender())
    this.pruneVideos()
    if (this.time > this.timeline.duration) this.time = this.timeline.duration
    this.syncVideos(this.time)
    this.requestRender()
  }

  setSize(width: number, height: number): void {
    const w = Math.max(2, Math.round(width))
    const h = Math.max(2, Math.round(height))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      this.requestRender()
    }
  }

  seek(time: number): void {
    this.time = clamp(time, 0, this.timeline.duration)
    if (this.playing) {
      this.clockOrigin = this.time
      this.clockStart = performance.now()
      void this.audio.start(this.time)
    }
    this.syncVideos(this.time)
    this.requestRender()
  }

  async play(): Promise<void> {
    if (this.playing || !this.project) return
    if (this.time >= this.timeline.duration - 0.05) this.time = 0
    this.playing = true
    this.clockOrigin = this.time
    this.clockStart = performance.now()
    await this.audio.start(this.time)
    if (!this.playing) return
    this.syncVideos(this.time)
    this.tick()
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.audio.stop()
    for (const slot of this.videos.values()) slot.el.pause()
    this.syncVideos(this.time)
    this.requestRender()
  }

  get isPlaying(): boolean {
    return this.playing
  }

  private clockNow(): number {
    if (this.audio.clockRunning) return this.audio.now()
    return this.clockOrigin + (performance.now() - this.clockStart) / 1000
  }

  private tick = () => {
    if (!this.playing || this.disposed) return
    const t = this.clockNow()
    if (t >= this.timeline.duration) {
      this.time = this.timeline.duration
      this.playing = false
      this.audio.stop()
      for (const slot of this.videos.values()) slot.el.pause()
      this.draw()
      this.onTime(this.time)
      this.onEnded()
      return
    }
    this.time = t
    this.syncVideos(t)
    this.draw()
    this.onTime(t)
    this.raf = requestAnimationFrame(this.tick)
  }

  requestRender(): void {
    if (this.renderQueued || this.disposed) return
    this.renderQueued = true
    requestAnimationFrame(() => {
      this.renderQueued = false
      if (!this.playing) this.draw()
    })
  }

  private sources: FrameSources = {
    image: (assetId) => {
      const entry = this.assets[assetId]
      if (!entry) return null
      return this.cache.image(entry.meta, entry.thumbnailUrl)
    },
    videoFrame: (sceneId, assetId) => {
      const slot = this.videos.get(sceneId)
      if (!slot || slot.assetId !== assetId || !slot.ready || slot.el.readyState < 2) return null
      const image: SourceImage = { source: slot.el, width: slot.el.videoWidth, height: slot.el.videoHeight }
      return image.width > 0 ? image : null
    },
    videoDuration: (assetId) => {
      const meta = this.metas[assetId]
      return meta?.kind === 'video' ? meta.duration : undefined
    },
    depth: (assetId) => {
      if (this.depths.has(assetId)) return this.depths.get(assetId) ?? null
      if (!this.depthLoading.has(assetId)) {
        this.depthLoading.add(assetId)
        void getAnalyses([assetId])
          .then((found) => {
            this.depths.set(assetId, found.get(assetId) ?? null)
            this.requestRender()
          })
          .catch(() => this.depths.set(assetId, null))
          .finally(() => this.depthLoading.delete(assetId))
      }
      return null
    },
  }

  /** Forget a cached depth map (call after analyzing an image) so the next frame picks it up. */
  refreshDepth(assetId: string): void {
    this.depths.delete(assetId)
    this.requestRender()
  }

  private draw(): void {
    if (!this.project) return
    this.compositor.render(
      this.ctx,
      this.canvas.width,
      this.canvas.height,
      { project: this.project, timeline: this.timeline, sources: this.sources },
      this.time,
      { placeholders: true },
    )
  }

  /** Scenes that are (or are about to be) on screen at time t, with their local time. */
  private activeVideoScenes(t: number): { entry: TimelineEntry; local: number; visible: boolean }[] {
    const out: { entry: TimelineEntry; local: number; visible: boolean }[] = []
    const { plan } = frameAt(this.timeline, t)
    if (plan.kind === 'scene') out.push({ entry: plan.entry, local: plan.localTime, visible: true })
    if (plan.kind === 'transition') {
      out.push({ entry: plan.from, local: plan.fromLocal, visible: true })
      out.push({ entry: plan.to, local: plan.toLocal, visible: true })
    }
    // Warm up the scene that becomes visible next.
    for (const entry of this.timeline.entries) {
      if (entry.visibleStart > t && entry.visibleStart - t < PRELOAD_AHEAD) {
        out.push({ entry, local: -entry.inDuration / 2, visible: false })
      }
    }
    return out.filter(({ entry }) => {
      const bg = entry.scene.background
      return bg.kind === 'media' && this.metas[bg.assetId]?.kind === 'video'
    })
  }

  private syncVideos(t: number): void {
    const now = performance.now()
    const needed = new Set<string>()
    for (const { entry, local, visible } of this.activeVideoScenes(t)) {
      const bg = entry.scene.background
      if (bg.kind !== 'media') continue
      const meta = this.metas[bg.assetId]
      const slot = this.ensureVideo(entry.scene.id, bg.assetId)
      slot.lastNeeded = now
      needed.add(entry.scene.id)
      const expected = videoSourceTime(entry, local, bg.trimStart, meta?.duration, bg.loop)
      const el = slot.el
      el.muted = bg.volume <= 0 || !visible
      el.volume = clamp(bg.volume, 0, 1)
      el.loop = false
      if (this.playing && visible) {
        if (Math.abs(el.currentTime - expected) > DRIFT_TOLERANCE) el.currentTime = expected
        if (el.paused && meta?.duration && expected < meta.duration - 0.05) void el.play().catch(() => undefined)
      } else {
        if (!el.paused) el.pause()
        if (Math.abs(el.currentTime - expected) > 1 / 120) el.currentTime = expected
      }
    }
    for (const [sceneId, slot] of this.videos) {
      if (!needed.has(sceneId) && !slot.el.paused) slot.el.pause()
    }
  }

  private ensureVideo(sceneId: string, assetId: string): VideoSlot {
    const existing = this.videos.get(sceneId)
    if (existing && existing.assetId === assetId) return existing
    if (existing) this.releaseVideo(sceneId)
    const el = document.createElement('video')
    el.muted = true
    el.playsInline = true
    el.preload = 'auto'
    const slot: VideoSlot = { el, assetId, ready: false, lastNeeded: performance.now() }
    const redraw = () => {
      slot.ready = true
      this.requestRender()
    }
    el.addEventListener('loadeddata', redraw)
    el.addEventListener('seeked', redraw)
    void this.cache.objectUrl(assetId).then((url) => {
      if (!this.disposed && this.videos.get(sceneId) === slot) {
        el.src = url
        this.syncVideos(this.time)
      }
    })
    this.videos.set(sceneId, slot)
    return slot
  }

  private releaseVideo(sceneId: string): void {
    const slot = this.videos.get(sceneId)
    if (!slot) return
    slot.el.pause()
    slot.el.removeAttribute('src')
    slot.el.load()
    this.videos.delete(sceneId)
  }

  /** Drop video elements for scenes that are gone or haven't been needed for a while. */
  private pruneVideos(): void {
    const sceneIds = new Set(this.project?.scenes.map((s) => s.id))
    const now = performance.now()
    for (const [sceneId, slot] of this.videos) {
      if (!sceneIds.has(sceneId) || now - slot.lastNeeded > 20_000) this.releaseVideo(sceneId)
    }
  }

  /** Render the current frame to a small JPEG (used for project posters). */
  async snapshot(time: number, width = 480): Promise<Blob | null> {
    if (!this.project || this.timeline.duration <= 0) return null
    const aspect = this.canvas.width / this.canvas.height
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.round(width / aspect)
    // Reuse the preview's compositor (and its single WebGL context) at poster size.
    this.compositor.render(
      get2d(canvas),
      canvas.width,
      canvas.height,
      { project: this.project, timeline: this.timeline, sources: this.sources },
      time,
    )
    this.requestRender()
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8))
  }

  dispose(): void {
    this.disposed = true
    this.playing = false
    document.fonts?.removeEventListener('loadingdone', this.onFontsLoaded)
    cancelAnimationFrame(this.raf)
    for (const id of this.videos.keys()) this.releaseVideo(id)
    this.audio.dispose()
    this.cache.dispose()
    this.compositor.dispose()
  }
}
