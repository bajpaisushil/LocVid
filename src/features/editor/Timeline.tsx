import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Mic,
  MoreHorizontal,
  Music,
  Plus,
  Sparkles,
  SquareDashed,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buildAudioPlan } from '@/core/audioPlan'
import { createGeneratedBackground, createOverlay, createScene, paletteFor } from '@/core/defaults'
import { addScenes, moveScene, setSceneDuration, setSceneMedia } from '@/core/operations'
import { buildTimeline, type TimelineEntry } from '@/core/timeline'
import type { AssetMeta, Scene } from '@/core/types'
import { hashString } from '@/lib/id'
import { formatDuration, formatTime } from '@/lib/format'
import { clamp } from '@/lib/math'
import { cn } from '@/lib/utils'
import { useEditorStore, useProject, type AssetEntry } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'
import { ASSET_DRAG_TYPE } from './AssetPanel'
import { sceneActions, seekToScene } from './sceneActions'

const LEFT_PAD = 12
const DRAG_INSTRUCTIONS =
  'To reorder a scene, press Enter to pick it up, use the left and right arrow keys to move it, then press Enter to drop it or Escape to cancel.'
const MIN_PX_PER_SEC = 6
const MAX_PX_PER_SEC = 240

function backgroundStyle(scene: Scene, assets: Record<string, AssetEntry>): React.CSSProperties {
  const bg = scene.background
  if (bg.kind === 'media') {
    const thumb = assets[bg.assetId]?.thumbnailUrl
    return thumb ? { backgroundImage: `url(${thumb})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}
  }
  const [a, b] = [bg.colors[0] ?? '#333', bg.colors[1] ?? bg.colors[0] ?? '#333']
  return { backgroundImage: `linear-gradient(135deg, ${a}, ${b})` }
}

export function Timeline() {
  const project = useProject()
  const assets = useEditorStore((s) => s.assets)
  const apply = useEditorStore((s) => s.apply)
  const timeline = useMemo(() => buildTimeline(project), [project])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewWidth, setViewWidth] = useState(800)
  const [zoom, setZoom] = useState<number | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fitPx = clamp((viewWidth - LEFT_PAD * 2 - 140) / Math.max(1, timeline.duration), MIN_PX_PER_SEC, 120)
  const pxPerSec = zoom ?? fitPx
  const contentWidth = LEFT_PAD * 2 + timeline.duration * pxPerSec + 160

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Enter picks a scene up (Space stays play/pause); arrows move it; Enter/Space drops; Esc cancels.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Enter'], cancel: ['Escape'], end: ['Enter', 'Space'] },
    }),
  )
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = project.scenes.findIndex((s) => s.id === active.id)
    const to = project.scenes.findIndex((s) => s.id === over.id)
    if (from >= 0 && to >= 0) apply((d) => moveScene(d, from, to))
  }

  // Screen-reader announcements in terms of scene positions, not internal IDs.
  const position = (id: string | number) => project.scenes.findIndex((s) => s.id === id) + 1
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up scene ${position(active.id)}. Use the arrow keys to move it.`,
    onDragOver: ({ active, over }) =>
      over ? `Scene ${position(active.id)} is over position ${position(over.id)}.` : `Scene ${position(active.id)} is no longer over a position.`,
    onDragEnd: ({ active, over }) =>
      over ? `Scene ${position(active.id)} dropped at position ${position(over.id)}.` : `Scene ${position(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving scene ${position(active.id)} was cancelled.`,
  }

  const addBlankScene = (kind: 'blank' | 'title') => {
    const index = project.scenes.length
    const scene = createScene({ index, title: kind === 'title' ? 'Title card' : undefined })
    if (kind === 'title') {
      scene.background = createGeneratedBackground('aurora', paletteFor(index + 4), hashString(scene.id))
      scene.overlays.push(createOverlay('Your title here', 'title', project.aspectRatio))
      scene.overlays.push({ ...createOverlay('A short subtitle', 'subtitle', project.aspectRatio), start: 0.4 })
    }
    apply((d) => addScenes(d, [scene]), { select: { kind: 'scene', sceneId: scene.id } })
    usePlaybackStore.getState().seek(timeline.duration + 0.05)
  }

  return (
    <section className="flex h-56 shrink-0 flex-col border-t bg-panel" aria-label="Timeline">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="text-sm font-medium">Timeline</h2>
        <span className="text-xs text-muted-foreground tabular" data-testid="timeline-summary">
          {project.scenes.length} scene{project.scenes.length === 1 ? '' : 's'} · {formatTime(timeline.duration)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="secondary" data-testid="add-scene">
                <Plus /> Scene
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => addBlankScene('blank')} data-testid="add-blank-scene">
                <SquareDashed /> Blank gradient scene
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => addBlankScene('title')}>
                <Type /> Title card
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom out timeline"
            onClick={() => setZoom(clamp(pxPerSec / 1.4, MIN_PX_PER_SEC, MAX_PX_PER_SEC))}
          >
            <ZoomOut />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="text-xs text-muted-foreground"
            onClick={() => setZoom(null)}
            aria-label="Fit timeline to width"
          >
            Fit
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom in timeline"
            onClick={() => setZoom(clamp(pxPerSec * 1.4, MIN_PX_PER_SEC, MAX_PX_PER_SEC))}
          >
            <ZoomIn />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="relative h-full" style={{ width: Math.max(contentWidth, viewWidth) }}>
          <Ruler duration={timeline.duration} pxPerSec={pxPerSec} />
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{ announcements, screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}
          >
            <SortableContext items={project.scenes.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
              <ol
                className="absolute top-7 flex h-[5.25rem] items-stretch"
                style={{ left: LEFT_PAD }}
                aria-label="Scenes"
                data-testid="scene-list"
              >
                {timeline.entries.map((entry) => (
                  <SceneBlock key={entry.scene.id} entry={entry} pxPerSec={pxPerSec} assets={assets} count={timeline.entries.length} />
                ))}
                <li className="ml-2 flex items-center">
                  <NewSceneDropZone onAddBlank={() => addBlankScene('blank')} empty={project.scenes.length === 0} />
                </li>
              </ol>
            </SortableContext>
          </DndContext>
          <AudioLane pxPerSec={pxPerSec} />
          <Playhead pxPerSec={pxPerSec} scrollRef={scrollRef} />
        </div>
      </div>
    </section>
  )
}

function Ruler({ duration, pxPerSec }: { duration: number; pxPerSec: number }) {
  const step = pxPerSec >= 60 ? 1 : pxPerSec >= 24 ? 5 : pxPerSec >= 10 ? 10 : 30
  const ticks: number[] = []
  for (let t = 0; t <= duration + 0.0001; t += step) ticks.push(t)
  const scrubbing = useRef(false)
  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = (e.clientX - rect.left - LEFT_PAD) / pxPerSec
    usePlaybackStore.getState().seek(clamp(t, 0, duration))
  }
  return (
    <div
      className="absolute inset-x-0 top-0 h-6 cursor-pointer border-b border-border/60 select-none"
      onPointerDown={(e) => {
        scrubbing.current = true
        usePlaybackStore.getState().pause()
        e.currentTarget.setPointerCapture(e.pointerId)
        seekFromEvent(e)
      }}
      onPointerMove={(e) => scrubbing.current && seekFromEvent(e)}
      onPointerUp={() => (scrubbing.current = false)}
      aria-hidden
    >
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute top-0 h-full border-l border-border/70 pl-1 text-[10px] leading-6 text-muted-foreground tabular"
          style={{ left: LEFT_PAD + t * pxPerSec }}
        >
          {formatTime(t, false)}
        </span>
      ))}
    </div>
  )
}

function Playhead({ pxPerSec, scrollRef }: { pxPerSec: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const time = usePlaybackStore((s) => s.time)
  const playing = usePlaybackStore((s) => s.playing)
  const left = LEFT_PAD + time * pxPerSec
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    if (left > el.scrollLeft + el.clientWidth - 40 || left < el.scrollLeft) el.scrollLeft = left - 60
  }, [left, playing, scrollRef])
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-primary" style={{ left }} data-testid="playhead">
      <div className="absolute -top-px -left-[5px] h-2.5 w-[11px] rounded-b-sm bg-primary" />
    </div>
  )
}

function SceneBlock({
  entry,
  pxPerSec,
  assets,
  count,
}: {
  entry: TimelineEntry
  pxPerSec: number
  assets: Record<string, AssetEntry>
  count: number
}) {
  const { scene, index } = entry
  const selection = useEditorStore((s) => s.selection)
  const select = useEditorStore((s) => s.select)
  const apply = useEditorStore((s) => s.apply)
  const playheadInScene = usePlaybackStore((s) => s.time >= entry.start && s.time < entry.end)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id })
  const [dropping, setDropping] = useState(false)
  const selected = (selection.kind === 'scene' || selection.kind === 'overlay') && selection.sceneId === scene.id
  const width = Math.max(4, scene.duration * pxPerSec)
  const actions = sceneActions()
  const missing = scene.background.kind === 'media' && !assets[scene.background.assetId]

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startDuration = scene.duration
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const next = Math.round((startDuration + (ev.clientX - startX) / pxPerSec) * 10) / 10
      apply(
        (d) => {
          const s = d.scenes.find((x) => x.id === scene.id)
          if (s) setSceneDuration(s, next)
        },
        { coalesce: `duration:${scene.id}` },
      )
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  return (
    <li
      ref={setNodeRef}
      className={cn('group/scene relative flex shrink-0', isDragging && 'z-30 opacity-80')}
      style={{ width, transform: CSS.Translate.toString(transform), transition }}
      data-testid="scene-block"
      data-scene-id={scene.id}
    >
      {index > 0 ? <TransitionMarker entry={entry} /> : null}
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        aria-roledescription="sortable scene"
        aria-label={`Scene ${index + 1}: ${scene.title || 'Untitled'}, ${formatDuration(scene.duration)}. Press Enter to pick up and reorder with the arrow keys.`}
        aria-pressed={selected}
        onClick={() => {
          select({ kind: 'scene', sceneId: scene.id })
          seekToScene(entry)
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDropping(true)
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE)
          setDropping(false)
          const meta: AssetMeta | undefined = assets[assetId]?.meta
          if (!meta) return
          e.preventDefault()
          if (meta.kind === 'audio') {
            apply((d) => {
              const s = d.scenes.find((x) => x.id === scene.id)
              if (s) s.audio = { assetId: meta.id, volume: 1, offset: 0 }
            })
          } else {
            apply((d) => setSceneMedia(d, scene.id, meta))
          }
          select({ kind: 'scene', sceneId: scene.id })
        }}
        className={cn(
          'group relative mr-px flex h-full w-full cursor-grab flex-col justify-between overflow-hidden rounded-md border bg-secondary text-left outline-none active:cursor-grabbing',
          selected ? 'border-primary ring-2 ring-primary/60' : 'border-white/10 hover:border-white/25',
          playheadInScene && !selected && 'border-white/30',
          dropping && 'ring-2 ring-emerald-400',
          'focus-visible:ring-3 focus-visible:ring-ring/60',
        )}
        style={backgroundStyle(scene, assets)}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/65" />
        {width > 36 ? (
          <div className="relative flex items-start gap-1 p-1.5">
            <span className="rounded bg-black/55 px-1 text-[10px] font-semibold text-white tabular">{index + 1}</span>
            {width > 90 ? (
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white drop-shadow">{scene.title}</span>
            ) : null}
          </div>
        ) : null}
        {width > 36 ? (
          <div className="relative flex items-center gap-1 p-1.5 text-[10px] text-white/90">
            <span className="tabular" data-testid="scene-duration">
              {formatDuration(scene.duration)}
            </span>
            {scene.overlays.length > 0 && width > 70 ? <Type className="size-3 opacity-80" aria-label="Has text" /> : null}
            {scene.audio && width > 70 ? <Mic className="size-3 opacity-80" aria-label="Has voice-over" /> : null}
            {missing ? <span className="rounded bg-destructive/80 px-1 text-white">missing media</span> : null}
          </div>
        ) : null}
        <SceneMenu sceneId={scene.id} index={index} count={count} actions={actions} hidden={width < 70} />
      </div>
      <div
        role="separator"
        aria-label={`Drag to change the duration of scene ${index + 1}`}
        aria-orientation="vertical"
        className="absolute top-1 right-0 bottom-1 z-10 w-2 cursor-ew-resize rounded-r-md opacity-0 transition hover:bg-primary/70 hover:opacity-100 group-hover/scene:opacity-60"
        onPointerDown={startResize}
        data-testid="scene-resize"
      />
    </li>
  )
}

function SceneMenu({
  sceneId,
  index,
  count,
  actions,
  hidden,
}: {
  sceneId: string
  index: number
  count: number
  actions: ReturnType<typeof sceneActions>
  hidden: boolean
}) {
  if (hidden) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="absolute top-1 right-1 grid size-5 place-items-center rounded bg-black/55 text-white opacity-0 transition group-hover:opacity-100 group-aria-pressed:opacity-100 focus-visible:opacity-100"
          aria-label={`Scene ${index + 1} actions`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => actions.duplicate(sceneId)}>
          <Copy /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === 0} onSelect={() => actions.move(sceneId, -1)}>
          <ArrowLeft /> Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === count - 1} onSelect={() => actions.move(sceneId, 1)}>
          <ArrowRight /> Move right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(sceneId)} data-testid="delete-scene">
          <Trash2 /> Delete scene
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TransitionMarker({ entry }: { entry: TimelineEntry }) {
  const select = useEditorStore((s) => s.select)
  const active = entry.inType !== 'none' && entry.inDuration > 0
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'absolute top-1/2 -left-2 z-20 grid size-4 -translate-y-1/2 rotate-45 place-items-center rounded-[3px] border transition',
            active ? 'border-primary bg-primary/80 hover:bg-primary' : 'border-white/30 bg-background/80 hover:border-white/60',
          )}
          aria-label={`Transition into scene ${entry.index + 1}: ${active ? entry.inType : 'cut'}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            select({ kind: 'scene', sceneId: entry.scene.id })
            document.getElementById('section-transition')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          }}
        >
          {active ? <Sparkles className="size-2.5 -rotate-45 text-white" /> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>{active ? `${entry.inType} · ${entry.inDuration.toFixed(1)}s` : 'Cut (no transition)'}</TooltipContent>
    </Tooltip>
  )
}

function NewSceneDropZone({ onAddBlank, empty }: { onAddBlank(): void; empty: boolean }) {
  const assets = useEditorStore((s) => s.assets)
  const apply = useEditorStore((s) => s.apply)
  const [over, setOver] = useState(false)
  return (
    <button
      type="button"
      onClick={onAddBlank}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const meta = assets[e.dataTransfer.getData(ASSET_DRAG_TYPE)]?.meta
        if (!meta || meta.kind === 'audio') return
        e.preventDefault()
        const project = useEditorStore.getState().project!
        const scene = createScene({ index: project.scenes.length, asset: meta })
        apply((d) => addScenes(d, [scene]), { select: { kind: 'scene', sceneId: scene.id } })
      }}
      className={cn(
        'flex h-[4.75rem] items-center gap-2 rounded-md border border-dashed px-3 text-xs text-muted-foreground transition hover:border-primary/60 hover:text-foreground',
        over && 'border-emerald-400 text-foreground',
        empty ? 'w-72' : 'w-32',
      )}
      aria-label="Add a blank scene (or drop media here)"
    >
      <Plus className="size-4 shrink-0" />
      {empty ? 'Drop media here, or click to add a blank scene' : 'Drop or add'}
    </button>
  )
}

function AudioLane({ pxPerSec }: { pxPerSec: number }) {
  const project = useProject()
  const assets = useEditorStore((s) => s.assets)
  const selection = useEditorStore((s) => s.selection)
  const select = useEditorStore((s) => s.select)
  const apply = useEditorStore((s) => s.apply)
  const metas = useMemo(() => Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, v.meta])), [assets])
  const timeline = useMemo(() => buildTimeline(project), [project])
  const plan = useMemo(() => buildAudioPlan(project, metas, timeline, { includeVideoAudio: false }), [project, metas, timeline])
  const voiceovers = plan.filter((c) => c.source === 'voiceover')

  return (
    <div className="absolute inset-x-0 top-[7.4rem] h-[3.4rem]" aria-label="Audio tracks">
      {project.audioTracks.length === 0 && voiceovers.length === 0 ? (
        <p className="absolute top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/70" style={{ left: LEFT_PAD }}>
          <Music className="mr-1 inline size-3" /> Add music or narration from the Media panel (audio files → “Add as background music”).
        </p>
      ) : null}
      <div className="relative h-7">
        {project.audioTracks.map((track) => {
          const clip = plan.find((c) => c.id === `track:${track.id}`)
          const entry = assets[track.assetId]
          const duration = clip?.duration ?? 0
          const selected = selection.kind === 'audio' && selection.trackId === track.id
          const startDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
            const startX = e.clientX
            const startT = track.start
            const target = e.currentTarget
            let moved = false
            target.setPointerCapture(e.pointerId)
            const move = (ev: PointerEvent) => {
              const dt = (ev.clientX - startX) / pxPerSec
              if (Math.abs(ev.clientX - startX) > 3) moved = true
              if (!moved) return
              apply(
                (d) => {
                  const t = d.audioTracks.find((x) => x.id === track.id)
                  if (t) t.start = Math.max(0, Math.round((startT + dt) * 10) / 10)
                },
                { coalesce: `audio-move:${track.id}` },
              )
            }
            const up = () => {
              target.removeEventListener('pointermove', move)
              target.removeEventListener('pointerup', up)
            }
            target.addEventListener('pointermove', move)
            target.addEventListener('pointerup', up)
          }
          return (
            <button
              key={track.id}
              type="button"
              onPointerDown={startDrag}
              onClick={() => select({ kind: 'audio', trackId: track.id })}
              className={cn(
                'absolute top-0 flex h-7 items-center gap-1 overflow-hidden rounded-md border px-1.5 text-left text-[11px] text-emerald-50',
                selected ? 'border-emerald-300 ring-2 ring-emerald-300/50' : 'border-emerald-400/30 hover:border-emerald-300/70',
                track.role === 'narration' ? 'bg-sky-700/50' : 'bg-emerald-800/50',
              )}
              style={{ left: LEFT_PAD + track.start * pxPerSec, width: Math.max(24, duration * pxPerSec) }}
              aria-label={`${track.role === 'music' ? 'Music' : 'Narration'} track: ${entry?.meta.name ?? 'missing audio'}`}
              data-testid="audio-track"
            >
              {entry?.thumbnailUrl ? (
                <img src={entry.thumbnailUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-35" draggable={false} />
              ) : null}
              {track.role === 'music' ? <Music className="relative size-3 shrink-0" /> : <Mic className="relative size-3 shrink-0" />}
              <span className="relative truncate">{entry?.meta.name ?? 'Missing audio'}</span>
            </button>
          )
        })}
      </div>
      <div className="relative mt-1 h-5">
        {voiceovers.map((clip) => (
          <span
            key={clip.id}
            className="absolute top-0 flex h-5 items-center gap-1 overflow-hidden rounded border border-sky-400/30 bg-sky-800/40 px-1 text-[10px] text-sky-50"
            style={{ left: LEFT_PAD + clip.start * pxPerSec, width: Math.max(16, clip.duration * pxPerSec) }}
            title={`Voice-over: ${assets[clip.assetId]?.meta.name ?? ''}`}
          >
            <Mic className="size-2.5 shrink-0" />
            <span className="truncate">{assets[clip.assetId]?.meta.name}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
