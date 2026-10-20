import { AlertCircle, ArrowLeft, Check, Clapperboard, Download, Loader2, Redo2, Sparkles, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { navigate } from '@/app/router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { totalDuration } from '@/core/timeline'
import { MAX_PROJECT_DURATION } from '@/core/types'
import { formatTime } from '@/lib/format'
import { MOD_KEY } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { useEditorStore, useProject } from '@/state/editorStore'
import { retrySave } from './autosave'

function ToolbarButton({
  label,
  shortcut,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; shortcut?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent>
        {label} {shortcut ? <Kbd className="ml-1">{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

function ProjectName() {
  const project = useProject()
  const apply = useEditorStore((s) => s.apply)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.name)

  if (editing) {
    const commit = () => {
      const name = draft.trim()
      if (name && name !== project.name) apply((d) => void (d.name = name))
      setEditing(false)
    }
    return (
      <input
        aria-label="Project name"
        className="h-8 w-56 rounded-md border bg-input/30 px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        value={draft}
        maxLength={120}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className="max-w-[16rem] truncate rounded-md px-2 py-1 text-sm font-medium hover:bg-muted"
      title="Rename project"
      data-testid="project-name"
      onClick={() => {
        setDraft(project.name)
        setEditing(true)
      }}
    >
      {project.name}
    </button>
  )
}

function SaveIndicator() {
  const status = useEditorStore((s) => s.saveStatus)
  const error = useEditorStore((s) => s.saveError)
  if (status === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void retrySave()}>
            <AlertCircle /> Not saved — retry
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{error}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
      data-testid="save-status"
      data-status={status}
    >
      {status === 'saved' ? (
        <>
          <Check className="size-3.5 text-emerald-400" /> Saved locally
        </>
      ) : status === 'saving' ? (
        <>
          <Loader2 className="size-3.5 animate-spin" /> Saving…
        </>
      ) : (
        <>
          <span className="size-1.5 rounded-full bg-warning" /> Unsaved changes
        </>
      )}
    </span>
  )
}

export interface ToolbarProps {
  onOpenStoryboard(): void
  onOpenAI(): void
  onExport(): void
}

export function Toolbar({ onOpenStoryboard, onOpenAI, onExport }: ToolbarProps) {
  const project = useProject()
  const canUndo = useEditorStore((s) => s.past.length > 0)
  const canRedo = useEditorStore((s) => s.future.length > 0)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const duration = totalDuration(project.scenes)
  const over = duration > MAX_PROJECT_DURATION

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-panel px-2">
      <ToolbarButton label="Back to projects" onClick={() => navigate({ name: 'home' })}>
        <ArrowLeft />
      </ToolbarButton>
      <ProjectName />
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton label="Undo" shortcut={`${MOD_KEY}Z`} disabled={!canUndo} onClick={undo} data-testid="undo">
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton label="Redo" shortcut={`${MOD_KEY}⇧Z`} disabled={!canRedo} onClick={redo} data-testid="redo">
        <Redo2 />
      </ToolbarButton>
      <SaveIndicator />

      <div className="ml-auto flex items-center gap-2">
        <Badge variant="outline" className="hidden font-normal md:inline-flex">
          {project.aspectRatio}
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn('hidden text-xs tabular md:inline', over ? 'text-destructive' : 'text-muted-foreground')}
              data-testid="project-duration"
            >
              {formatTime(duration)} / {formatTime(MAX_PROJECT_DURATION, false)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {over ? 'Over the 5-minute limit — shorten scenes to export.' : 'Total length (limit 5:00)'}
          </TooltipContent>
        </Tooltip>
        <Button variant="ghost" onClick={onOpenStoryboard} data-testid="open-storyboard">
          <Clapperboard /> <span className="hidden lg:inline">Script to storyboard</span>
        </Button>
        <Button variant="ghost" onClick={onOpenAI} data-testid="open-ai">
          <Sparkles /> <span className="hidden lg:inline">AI tools</span>
        </Button>
        <Button onClick={onExport} data-testid="open-export">
          <Download /> Export
        </Button>
      </div>
    </header>
  )
}
