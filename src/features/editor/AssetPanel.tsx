import {
  AudioLines,
  Film,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  Music,
  Plus,
  Replace,
  Stamp,
  Trash2,
  Upload,
  Mic,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { confirm } from '@/components/dialog-api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createScene } from '@/core/defaults'
import { addAudioTrack, addScenes, assetUsage, removeAsset, setSceneMedia } from '@/core/operations'
import type { AssetKind, AssetMeta } from '@/core/types'
import { formatBytes, formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ACCEPT_ATTRIBUTE, SUPPORTED_SUMMARY } from '@/media/detect'
import { useEditorStore, useProject, type AssetEntry } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'
import { importIntoProject, useImportStore } from './mediaImport'

export const ASSET_DRAG_TYPE = 'application/x-locvid-asset'

type Filter = 'all' | AssetKind

const KIND_ICON: Record<AssetKind, typeof ImageIcon> = { image: ImageIcon, video: Film, audio: AudioLines }

export function AssetPanel() {
  const project = useProject()
  const assets = useEditorStore((s) => s.assets)
  const importing = useImportStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [dragOver, setDragOver] = useState(false)

  const entries = useMemo(
    () => project.assetIds.map((id) => assets[id]).filter((e): e is AssetEntry => !!e),
    [project.assetIds, assets],
  )
  const counts = useMemo(() => {
    const c = { all: entries.length, image: 0, video: 0, audio: 0 }
    for (const e of entries) c[e.meta.kind]++
    return c
  }, [entries])
  const visible = filter === 'all' ? entries : entries.filter((e) => e.meta.kind === filter)
  const totalBytes = entries.reduce((sum, e) => sum + e.meta.size, 0)

  return (
    <aside
      className={cn('relative flex min-h-0 flex-col border-r bg-panel', dragOver && 'ring-2 ring-primary ring-inset')}
      aria-label="Media"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        void importIntoProject([...e.dataTransfer.files])
      }}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <h2 className="text-sm font-medium">Media</h2>
        <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()} data-testid="import-media">
          <Upload /> Import
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          data-testid="media-input"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            void importIntoProject(files)
          }}
        />
      </div>

      <div className="flex shrink-0 gap-1 border-b px-2 py-1.5" role="tablist" aria-label="Filter media">
        {(['all', 'image', 'video', 'audio'] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-md px-2 py-1 text-xs transition',
              filter === f ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f === 'all' ? 'All' : f === 'image' ? 'Images' : f === 'video' ? 'Video' : 'Audio'}
            <span className="ml-1 text-muted-foreground tabular">{counts[f]}</span>
          </button>
        ))}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {importing.active ? (
          <div className="m-3 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs" role="status">
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            <span className="min-w-0 flex-1 truncate">
              Importing {importing.index + 1} of {importing.total}: {importing.fileName}
            </span>
          </div>
        ) : null}
        {entries.length === 0 && !importing.active ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="m-3 flex w-[calc(100%-1.5rem)] flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center transition hover:border-primary/60 hover:bg-muted/40"
          >
            <Upload className="size-6 text-muted-foreground" />
            <span className="text-sm font-medium">Drop files here or click to import</span>
            <span className="text-xs text-muted-foreground">Images, video clips, music and voice-overs</span>
            <span className="mt-1 text-[11px] text-muted-foreground/80">{SUPPORTED_SUMMARY}</span>
          </button>
        ) : visible.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">No {filter} files in this project yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 p-3" data-testid="asset-grid">
            {visible.map((entry) => (
              <AssetTile key={entry.meta.id} entry={entry} />
            ))}
          </ul>
        )}
      </ScrollArea>

      <p className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">
        {entries.length} file{entries.length === 1 ? '' : 's'} · {formatBytes(totalBytes)} · stored on this device
      </p>

      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-primary/10 text-sm font-medium text-primary">
          Drop to import
        </div>
      ) : null}
    </aside>
  )
}

function useAssetActions(meta: AssetMeta) {
  const apply = useEditorStore((s) => s.apply)
  return {
    addAsScene() {
      const project = useEditorStore.getState().project
      if (!project) return
      const scene = createScene({ index: project.scenes.length, asset: meta })
      apply((d) => addScenes(d, [scene]), { select: { kind: 'scene', sceneId: scene.id } })
      const start = project.scenes.reduce((t, s) => t + s.duration, 0)
      usePlaybackStore.getState().seek(start + 0.05)
    },
    replaceSelected(sceneId: string) {
      apply((d) => setSceneMedia(d, sceneId, meta))
    },
    addAudio(role: 'music' | 'narration') {
      const time = role === 'narration' ? usePlaybackStore.getState().time : 0
      let trackId = ''
      apply((d) => {
        trackId = addAudioTrack(d, meta, role, time).id
      })
      useEditorStore.getState().select({ kind: 'audio', trackId })
    },
    attachVoiceOver(sceneId: string) {
      apply((d) => {
        const scene = d.scenes.find((s) => s.id === sceneId)
        if (scene) scene.audio = { assetId: meta.id, volume: 1, offset: 0 }
      })
    },
    useAsLogo() {
      apply((d) => {
        d.brand.logoAssetId = meta.id
      })
    },
    async remove() {
      const project = useEditorStore.getState().project
      if (!project) return
      const usage = assetUsage(project, meta.id)
      const parts = [
        usage.scenes ? `${usage.scenes} scene${usage.scenes === 1 ? '' : 's'}` : null,
        usage.audioTracks ? `${usage.audioTracks} audio track${usage.audioTracks === 1 ? '' : 's'}` : null,
        usage.logo ? 'the logo watermark' : null,
      ].filter(Boolean)
      if (parts.length > 0) {
        const ok = await confirm({
          title: `Remove “${meta.name}”?`,
          description: `It is used in ${parts.join(', ')}. Scenes using it as a background will switch to a gradient. You can undo this.`,
          confirmLabel: 'Remove',
          destructive: true,
        })
        if (!ok) return
      }
      apply((d) => removeAsset(d, meta.id))
    },
  }
}

function AssetTile({ entry }: { entry: AssetEntry }) {
  const { meta, thumbnailUrl } = entry
  const project = useProject()
  const selection = useEditorStore((s) => s.selection)
  const actions = useAssetActions(meta)
  const Icon = KIND_ICON[meta.kind]
  const selectedSceneId = selection.kind === 'scene' || selection.kind === 'overlay' ? selection.sceneId : null
  const usage = useMemo(() => assetUsage(project, meta.id), [project, meta.id])
  const inUse = usage.scenes + usage.audioTracks + (usage.logo ? 1 : 0) > 0
  const details = [
    meta.width && meta.height ? `${meta.width}×${meta.height}` : null,
    meta.duration ? formatDuration(meta.duration) : null,
    formatBytes(meta.size),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li
      className="group relative flex min-w-0 flex-col gap-1"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_DRAG_TYPE, meta.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      data-testid="asset-tile"
      data-asset-kind={meta.kind}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'relative aspect-video w-full overflow-hidden rounded-md border bg-stage outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50',
              meta.kind === 'image' && meta.mimeType === 'image/png' && 'bg-checker',
            )}
            onDoubleClick={() => (meta.kind === 'audio' ? actions.addAudio('music') : actions.addAsScene())}
            aria-label={`${meta.name} (${meta.kind}). Double-click to ${meta.kind === 'audio' ? 'add as music' : 'add as a scene'}.`}
          >
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt=""
                draggable={false}
                className={cn('h-full w-full', meta.kind === 'audio' ? 'object-fill p-2 opacity-90' : 'object-cover')}
              />
            ) : (
              <Icon className="absolute inset-0 m-auto size-6 text-muted-foreground" />
            )}
            <span className="absolute top-1 left-1 grid size-5 place-items-center rounded bg-black/60 text-white">
              <Icon className="size-3" />
            </span>
            {meta.duration ? (
              <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] text-white tabular">
                {formatDuration(meta.duration)}
              </span>
            ) : null}
            {inUse ? (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-black/40" aria-label="In use" />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <div className="font-medium">{meta.name}</div>
          <div className="opacity-80">{details}</div>
          {meta.original ? (
            <div className="opacity-80">
              Optimized from {meta.original.width}×{meta.original.height} to save memory
            </div>
          ) : null}
          {meta.kind === 'video' && meta.hasAudio === false ? <div className="opacity-80">No audio track</div> : null}
        </TooltipContent>
      </Tooltip>
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={meta.name}>
          {meta.name}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${meta.name}`} className="opacity-70 group-hover:opacity-100">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{details}</DropdownMenuLabel>
            {meta.kind === 'audio' ? (
              <>
                <DropdownMenuItem onSelect={() => actions.addAudio('music')}>
                  <Music /> Add as background music
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.addAudio('narration')}>
                  <Mic /> Add as narration at playhead
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!selectedSceneId} onSelect={() => selectedSceneId && actions.attachVoiceOver(selectedSceneId)}>
                  <AudioLines /> Attach to selected scene
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem onSelect={actions.addAsScene}>
                  <Plus /> Add as new scene
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!selectedSceneId}
                  onSelect={() => selectedSceneId && actions.replaceSelected(selectedSceneId)}
                >
                  <Replace /> Use in selected scene
                </DropdownMenuItem>
                {meta.kind === 'image' ? (
                  <DropdownMenuItem onSelect={actions.useAsLogo}>
                    <Stamp /> Use as logo watermark
                  </DropdownMenuItem>
                ) : null}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void actions.remove()}>
              <Trash2 /> Remove from project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}
