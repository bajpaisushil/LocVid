import { Copy, Download, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { totalDuration } from '@/core/timeline'
import type { Project } from '@/core/types'
import { formatDuration, formatRelative } from '@/lib/format'
import { getAssets, getPoster } from '@/storage/repo'

export interface ProjectCardProps {
  project: Project
  onOpen(): void
  onRename(): void
  onDuplicate(): void
  onExportFile(): void
  onDelete(): void
}

/** Poster image: rendered frame if saved, else first scene's media thumbnail, else its gradient. */
function usePosterUrl(project: Project): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const firstMedia = project.scenes.find((s) => s.background.kind === 'media')?.background
  const firstAssetId = firstMedia?.kind === 'media' ? firstMedia.assetId : null
  const { id: projectId, updatedAt } = project
  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    void (async () => {
      try {
        let blob: Blob | null | undefined = await getPoster(projectId)
        if (!blob && firstAssetId) {
          const [asset] = await getAssets([firstAssetId])
          blob = asset?.thumbnail
        }
        if (blob && !cancelled) {
          created = URL.createObjectURL(blob)
          setUrl(created)
        }
      } catch {
        // poster is decorative; fall back to the gradient
      }
    })()
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
    // `updatedAt` is intentional: re-fetch the poster whenever the project was edited.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [projectId, updatedAt, firstAssetId])
  return url
}

function gradientFor(project: Project): string {
  const first = project.scenes[0]?.background
  const colors = first?.kind === 'generated' ? first.colors : ['#312e81', '#831843']
  return `linear-gradient(135deg, ${colors[0]}, ${colors[1] ?? colors[0]})`
}

const ASPECT_LABEL: Record<Project['aspectRatio'], string> = {
  '16:9': '16:9 · Landscape',
  '9:16': '9:16 · Vertical',
  '1:1': '1:1 · Square',
}

export function ProjectCard({ project, onOpen, onRename, onDuplicate, onExportFile, onDelete }: ProjectCardProps) {
  const poster = usePosterUrl(project)
  const duration = totalDuration(project.scenes)
  const posterAspect = project.aspectRatio === '16:9' ? 'aspect-video' : project.aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-square'

  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 focus-within:border-primary/50"
      data-testid="project-card"
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-video w-full overflow-hidden bg-stage outline-none"
        aria-label={`Open ${project.name}`}
      >
        <div className="absolute inset-0 opacity-60 blur-xl" style={{ backgroundImage: gradientFor(project) }} />
        <div className={`relative mx-auto h-full ${posterAspect} max-w-full overflow-hidden`}>
          {poster ? (
            <img src={poster} alt="" className="h-full w-full object-cover" draggable={false} />
          ) : (
            <div className="h-full w-full" style={{ backgroundImage: gradientFor(project) }} />
          )}
        </div>
        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white tabular">
          {formatDuration(duration)}
        </span>
      </button>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium" title={project.name} data-testid="project-card-title">
            {project.name}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="secondary" className="font-normal">
              {ASPECT_LABEL[project.aspectRatio]}
            </Badge>
            <span>
              {project.scenes.length} {project.scenes.length === 1 ? 'scene' : 'scenes'}
            </span>
            <span aria-hidden>·</span>
            <time dateTime={new Date(project.updatedAt).toISOString()} title={new Date(project.updatedAt).toLocaleString()}>
              Edited {formatRelative(project.updatedAt)}
            </time>
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${project.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={onRename}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExportFile}>
              <Download /> Export project file
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}
