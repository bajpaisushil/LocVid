import { planAssetIds, type AudioClip } from '@/core/audioPlan'
import { createMasterBus, scheduleClips } from '@/audio/schedule'
import type { PreviewMediaCache } from './mediaCache'

/**
 * Real-time playback of the project's audio plan through Web Audio. Its
 * context clock is the preview's master clock while playing, so picture and
 * sound stay in sync.
 */
export class PreviewAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private nodes: AudioBufferSourceNode[] = []
  private buffers = new Map<string, AudioBuffer>()
  private plan: AudioClip[] = []
  private playing = false
  private fromTime = 0
  private ctxStart = 0
  private generation = 0
  private readonly cache: PreviewMediaCache

  constructor(cache: PreviewMediaCache) {
    this.cache = cache
  }

  get available(): boolean {
    return typeof AudioContext !== 'undefined'
  }

  setPlan(plan: AudioClip[]): void {
    this.plan = plan
    if (this.playing) this.reschedule(this.now())
  }

  async start(time: number): Promise<void> {
    if (!this.available) return
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      this.master = createMasterBus(this.ctx)
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume()
      } catch {
        // Autoplay blocked: picture still plays, driven by the fallback clock.
      }
    }
    this.playing = true
    this.reschedule(time)
  }

  private reschedule(time: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    this.stopNodes()
    const generation = ++this.generation
    this.fromTime = time
    this.ctxStart = ctx.currentTime + 0.03
    this.nodes = scheduleClips(ctx, this.plan, this.buffers, {
      fromTime: time,
      ctxTime: this.ctxStart,
      destination: this.master,
    })
    // Decode anything missing; schedule it from "now" once it's ready.
    for (const assetId of planAssetIds(this.plan)) {
      if (this.buffers.has(assetId)) continue
      void this.cache.audioBuffer(ctx, assetId).then((buffer) => {
        if (!buffer || generation !== this.generation || !this.playing || !this.master) return
        this.buffers.set(assetId, buffer)
        const now = this.now()
        const clips = this.plan.filter((c) => c.assetId === assetId)
        this.nodes.push(
          ...scheduleClips(ctx, clips, this.buffers, { fromTime: now, ctxTime: ctx.currentTime + 0.03, destination: this.master }),
        )
      })
    }
  }

  /** Current timeline time according to the audio clock (only meaningful while playing). */
  now(): number {
    if (!this.ctx || !this.playing || this.ctx.state !== 'running') return this.fromTime
    return this.fromTime + Math.max(0, this.ctx.currentTime - this.ctxStart)
  }

  get clockRunning(): boolean {
    return !!this.ctx && this.playing && this.ctx.state === 'running'
  }

  private stopNodes(): void {
    for (const node of this.nodes) {
      try {
        node.stop()
      } catch {
        // not started yet
      }
      node.disconnect()
    }
    this.nodes = []
  }

  stop(): void {
    this.playing = false
    this.generation++
    this.stopNodes()
  }

  dispose(): void {
    this.stop()
    this.buffers.clear()
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }
}
