import { ArrowLeft, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { navigate } from '@/app/router'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { errorMessage } from '@/lib/errors'
import { useEditorStore } from '@/state/editorStore'
import { buildTimeline } from '@/core/timeline'
import { getAssets, getProject, savePoster } from '@/storage/repo'
import { AIDialog } from '@/features/ai/AIDialog'
import { ExportDialog } from '@/features/export/ExportDialog'
import { StoryboardDialog } from '@/features/storyboard/StoryboardDialog'
import { AssetPanel } from './AssetPanel'
import { startAutosave } from './autosave'
import { importIntoProject } from './mediaImport'
import { PreviewPanel } from './PreviewPanel'
import { getPreviewEngine } from './previewRegistry'
import { PropertiesPanel } from './PropertiesPanel'
import { useEditorShortcuts } from './shortcuts'
import { Timeline } from './Timeline'
import { Toolbar } from './Toolbar'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' }

export function EditorScreen({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    let stopAutosave: (() => Promise<void>) | null = null
    void (async () => {
      try {
        const project = await getProject(projectId)
        const assets = await getAssets(project.assetIds)
        if (cancelled) return
        useEditorStore.getState().open(project, assets)
        document.title = `${project.name} — LocVid`
        stopAutosave = startAutosave()
        setLoad({ status: 'ready' })
      } catch (error) {
        if (!cancelled) setLoad({ status: 'error', message: errorMessage(error) })
      }
    })()
    return () => {
      cancelled = true
      const stop = stopAutosave
      // Flush the last edit before releasing the project.
      void (stop ? stop() : Promise.resolve()).finally(() => {
        if (useEditorStore.getState().project?.id === projectId) useEditorStore.getState().close()
      })
    }
  }, [projectId])

  if (load.status === 'loading') {
    return (
      <div className="grid h-full place-items-center text-muted-foreground" aria-busy="true">
        <span className="inline-flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Opening project…
        </span>
      </div>
    )
  }
  if (load.status === 'error') {
    return (
      <div className="grid h-full place-items-center p-6">
        <Empty className="max-w-md border">
          <EmptyHeader>
            <EmptyTitle>This project could not be opened</EmptyTitle>
            <EmptyDescription>{load.message}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => navigate({ name: 'home' })}>
              <ArrowLeft /> Back to projects
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }
  return <EditorWorkspace projectId={projectId} />
}

function usePosterUpdates(projectId: string) {
  const saveStatus = useEditorStore((s) => s.saveStatus)
  const revision = useEditorStore((s) => s.revision)
  useEffect(() => {
    if (saveStatus !== 'saved' || revision === 0) return
    // After edits settle, store a small rendered frame for the home screen.
    const timer = setTimeout(() => {
      const project = useEditorStore.getState().project
      const engine = getPreviewEngine()
      if (!project || !engine || project.scenes.length === 0) return
      const first = buildTimeline(project).entries[0]!
      void engine
        .snapshot(first.start + Math.min(first.scene.duration * 0.6, 2))
        .then((blob) => blob && savePoster(projectId, blob))
        .catch(() => undefined)
    }, 2500)
    return () => clearTimeout(timer)
  }, [saveStatus, revision, projectId])
}

function EditorWorkspace({ projectId }: { projectId: string }) {
  const [dialog, setDialog] = useState<'storyboard' | 'export' | 'ai' | null>(null)
  const [fileDrag, setFileDrag] = useState(false)
  useEditorShortcuts(dialog === null)
  usePosterUpdates(projectId)

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-testid="editor"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setFileDrag(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileDrag(false)
      }}
      onDrop={(e) => {
        setFileDrag(false)
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        const overTimeline = (e.target as HTMLElement).closest('[aria-label="Timeline"]') !== null
        void importIntoProject([...e.dataTransfer.files], { asScenes: overTimeline })
      }}
    >
      <Toolbar onOpenStoryboard={() => setDialog('storyboard')} onOpenAI={() => setDialog('ai')} onExport={() => setDialog('export')} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,272px)_minmax(0,1fr)_minmax(280px,330px)]">
        <AssetPanel />
        <PreviewPanel />
        <PropertiesPanel />
      </div>
      <Timeline />
      {fileDrag ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-primary/10 ring-2 ring-primary ring-inset">
          <p className="rounded-lg bg-background/90 px-4 py-2 text-sm font-medium shadow-lg">
            Drop to import · drop on the timeline to add as scenes
          </p>
        </div>
      ) : null}
      <StoryboardDialog open={dialog === 'storyboard'} onOpenChange={(o) => setDialog(o ? 'storyboard' : null)} />
      <ExportDialog open={dialog === 'export'} onOpenChange={(o) => setDialog(o ? 'export' : null)} />
      <AIDialog open={dialog === 'ai'} onOpenChange={(o) => setDialog(o ? 'ai' : null)} />
    </div>
  )
}
