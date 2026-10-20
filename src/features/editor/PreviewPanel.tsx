import { ChevronFirst, ChevronLast, Pause, Play, StepBack, StepForward } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { outputDimensions } from '@/core/defaults'
import { buildTimeline, frameAt, sceneIndexAt } from '@/core/timeline'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PreviewEngine } from '@/preview/engine'
import { overlayBox } from '@/render/text'
import { useEditorStore, useProject } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'
import { getPreviewEngine, setPreviewEngine } from './previewRegistry'

/** The live preview shares the exporter's renderer; it just draws at screen size. */
const MAX_PREVIEW_LONG_SIDE = 1280

export function PreviewPanel() {
  const project = useProject()
  const stageRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<PreviewEngine | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const { width: outW, height: outH } = outputDimensions(project.aspectRatio, '720p')
  const aspect = outW / outH

  // The engine is created with its canvas and disposed with it (ref callback with cleanup).
  const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return
    const created = new PreviewEngine(canvas)
    setPreviewEngine(created)
    created.onTime = (t) => usePlaybackStore.getState().setTime(t)
    created.onEnded = () => usePlaybackStore.getState().pause()
    const { project: p, assets } = useEditorStore.getState()
    if (p) created.setInput(p, assets)
    created.seek(usePlaybackStore.getState().time)
    const unsubEditor = useEditorStore.subscribe((s, prev) => {
      if (s.project && (s.project !== prev.project || s.assets !== prev.assets)) created.setInput(s.project, s.assets)
    })
    const unsubPlayback = usePlaybackStore.subscribe((s, prev) => {
      if (s.playing !== prev.playing) {
        if (s.playing) void created.play()
        else created.pause()
      }
      if (s.seekToken !== prev.seekToken) created.seek(s.time)
    })
    setEngine(created)
    return () => {
      unsubEditor()
      unsubPlayback()
      usePlaybackStore.getState().pause()
      created.dispose()
      if (getPreviewEngine() === created) setPreviewEngine(null)
      setEngine(null)
    }
  }, [])

  // Fit the canvas to the stage, keeping the project's aspect ratio.
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || !engine) return
    const observer = new ResizeObserver(() => {
      const rect = stage.getBoundingClientRect()
      const availW = Math.max(0, rect.width - 32)
      const availH = Math.max(0, rect.height - 32)
      const width = Math.min(availW, availH * aspect)
      const height = width / aspect
      setBox({ width, height })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const scale = Math.min(1, MAX_PREVIEW_LONG_SIDE / Math.max(width * dpr, height * dpr))
      engine.setSize(width * dpr * scale, height * dpr * scale)
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [aspect, engine])

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-stage" aria-label="Preview">
      <div ref={stageRef} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden">
        <div className="relative shadow-2xl shadow-black/60" style={{ width: box.width, height: box.height }}>
          <canvas
            ref={canvasRef}
            className="block h-full w-full rounded-sm bg-black"
            data-testid="preview-canvas"
            aria-label="Video preview"
            role="img"
          />
          {engine ? <OverlayInteraction engine={engine} /> : null}
          {project.scenes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
              <div className="max-w-sm">
                <p className="text-sm font-medium text-white/90">Your video is empty</p>
                <p className="mt-1 text-xs text-white/60">
                  Import media and add it as scenes, or turn a script into a storyboard. Scenes appear on the timeline below.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <Transport />
    </section>
  )
}

/** Drag text overlays directly on the preview; shows the selected overlay's bounds. */
function OverlayInteraction({ engine }: { engine: PreviewEngine }) {
  const project = useProject()
  const selection = useEditorStore((s) => s.selection)
  const time = usePlaybackStore((s) => s.time)
  const playing = usePlaybackStore((s) => s.playing)
  const apply = useEditorStore((s) => s.apply)
  const select = useEditorStore((s) => s.select)
  const drag = useRef<{ overlayId: string; sceneId: string; startX: number; startY: number; ox: number; oy: number } | null>(null)

  const timeline = buildTimeline(project)
  const plan = frameAt(timeline, time).plan
  const entry = plan.kind === 'scene' ? plan.entry : plan.kind === 'transition' ? (plan.progress < 0.5 ? plan.from : plan.to) : null
  const scene = entry?.scene

  const hit = (clientX: number, clientY: number) => {
    const canvas = engine.canvasElement
    if (!scene) return null
    const rect = canvas.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * canvas.width
    const y = ((clientY - rect.top) / rect.height) * canvas.height
    for (let i = scene.overlays.length - 1; i >= 0; i--) {
      const o = scene.overlays[i]!
      if (!o.text.trim()) continue
      const b = overlayBox(engine.context, o, canvas.width, canvas.height)
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return o
    }
    return null
  }

  const selected =
    selection.kind === 'overlay' && scene?.id === selection.sceneId
      ? scene.overlays.find((o) => o.id === selection.overlayId)
      : undefined
  let outline: { left: string; top: string; width: string; height: string } | null = null
  if (selected && !playing && selected.text.trim()) {
    const { width, height } = engine.size
    const b = overlayBox(engine.context, selected, width, height)
    outline = {
      left: `${(b.x / width) * 100}%`,
      top: `${(b.y / height) * 100}%`,
      width: `${(b.width / width) * 100}%`,
      height: `${(b.height / height) * 100}%`,
    }
  }

  return (
    <div
      className={cn('absolute inset-0', scene?.overlays.length ? 'cursor-default' : '')}
      onPointerDown={(e) => {
        if (playing || e.button !== 0) return
        const o = hit(e.clientX, e.clientY)
        if (!o || !scene) {
          if (scene) select({ kind: 'scene', sceneId: scene.id })
          return
        }
        select({ kind: 'overlay', sceneId: scene.id, overlayId: o.id })
        drag.current = { overlayId: o.id, sceneId: scene.id, startX: e.clientX, startY: e.clientY, ox: o.x, oy: o.y }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        const canvasEl = engine.canvasElement
        if (!d) {
          const o = hit(e.clientX, e.clientY)
          e.currentTarget.style.cursor = o && !playing ? 'move' : 'default'
          return
        }
        const rect = canvasEl.getBoundingClientRect()
        const nx = d.ox + (e.clientX - d.startX) / rect.width
        const ny = d.oy + (e.clientY - d.startY) / rect.height
        // Snap to the horizontal/vertical center when close.
        const sx = Math.abs(nx - 0.5) < 0.012 ? 0.5 : nx
        const sy = Math.abs(ny - 0.5) < 0.012 ? 0.5 : ny
        apply(
          (draft) => {
            const o = draft.scenes.find((s) => s.id === d.sceneId)?.overlays.find((x) => x.id === d.overlayId)
            if (o) {
              o.x = Math.min(1.2, Math.max(-0.2, Number(sx.toFixed(4))))
              o.y = Math.min(1.2, Math.max(-0.2, Number(sy.toFixed(4))))
            }
          },
          { coalesce: `drag:${d.overlayId}` },
        )
      }}
      onPointerUp={(e) => {
        drag.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      }}
    >
      {outline ? (
        <div
          className="pointer-events-none absolute rounded-sm border border-dashed border-primary shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={outline}
          data-testid="overlay-outline"
        />
      ) : null}
    </div>
  )
}

function TimeReadout() {
  const time = usePlaybackStore((s) => s.time)
  const project = useProject()
  const timeline = buildTimeline(project)
  const index = sceneIndexAt(timeline, time)
  return (
    <div className="flex min-w-0 items-baseline gap-2 text-xs tabular" data-testid="time-readout">
      <span className="font-medium text-foreground">{formatTime(time)}</span>
      <span className="text-muted-foreground">/ {formatTime(timeline.duration)}</span>
      {index >= 0 ? <span className="hidden truncate text-muted-foreground sm:inline">· Scene {index + 1}</span> : null}
    </div>
  )
}

function Scrubber() {
  const time = usePlaybackStore((s) => s.time)
  const project = useProject()
  const duration = buildTimeline(project).duration
  return (
    <Slider
      aria-label="Seek"
      className="flex-1"
      min={0}
      max={Math.max(duration, 0.01)}
      step={1 / 30}
      value={[Math.min(time, duration)]}
      disabled={duration <= 0}
      onValueChange={([v]) => usePlaybackStore.getState().seek(v ?? 0)}
      data-testid="scrubber"
    />
  )
}

function stepBy(delta: number) {
  const { time, seek, pause } = usePlaybackStore.getState()
  pause()
  seek(Math.max(0, time + delta))
}

function Transport() {
  const playing = usePlaybackStore((s) => s.playing)
  const project = useProject()
  const empty = project.scenes.length === 0
  const fps = project.output.fps
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t bg-panel px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Go to start" onClick={() => usePlaybackStore.getState().seek(0)} disabled={empty}>
            <ChevronFirst />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Go to start (Home)</TooltipContent>
      </Tooltip>
      <Button variant="ghost" size="icon-sm" aria-label="Previous frame" onClick={() => stepBy(-1 / fps)} disabled={empty}>
        <StepBack />
      </Button>
      <Button
        size="icon"
        className="rounded-full"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => usePlaybackStore.getState().toggle()}
        disabled={empty}
        data-testid="play-toggle"
      >
        {playing ? <Pause className="fill-current" /> : <Play className="translate-x-px fill-current" />}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next frame" onClick={() => stepBy(1 / fps)} disabled={empty}>
        <StepForward />
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Go to end"
            onClick={() => usePlaybackStore.getState().seek(buildTimeline(project).duration)}
            disabled={empty}
          >
            <ChevronLast />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Go to end (End)</TooltipContent>
      </Tooltip>
      <TimeReadout />
      <Scrubber />
    </div>
  )
}
