import { Clapperboard, FileUp, Lock, Plus, Sparkles, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { navigate } from '@/app/router'
import { confirm, promptText } from '@/components/dialog-api'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { createProject } from '@/core/defaults'
import type { Project } from '@/core/types'
import { downloadBlob, safeFileName } from '@/lib/download'
import { errorMessage } from '@/lib/errors'
import { collectGarbage, deleteProject, listProjects, renameProject, saveProject } from '@/storage/repo'
import { NewProjectDialog } from './NewProjectDialog'
import { PromptHero } from './PromptHero'
import { ProjectCard } from './ProjectCard'
import { buildProjectFile, duplicateProject, importProjectFile } from './projectFile'
import { StorageCard } from './StorageCard'

async function exportFile(project: Project) {
  try {
    downloadBlob(await buildProjectFile(project.id), `${safeFileName(project.name, 'project')}.locvid.json`)
  } catch (error) {
    toast.error('Could not export the project file', { description: errorMessage(error) })
  }
}

type ListState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; projects: Project[] }

export function HomeScreen() {
  const [state, setState] = useState<ListState>({ status: 'loading' })
  const [newOpen, setNewOpen] = useState(false)
  const [storageKey, setStorageKey] = useState(0)
  const importRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'ready', projects: await listProjects() })
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) })
    }
    setStorageKey((k) => k + 1)
  }, [])

  useEffect(() => {
    document.title = 'LocVid — Local Video Studio'
    // Reclaim space from media no project uses any more, then list projects.
    void collectGarbage()
      .catch(() => undefined)
      .finally(() => void refresh())
  }, [refresh])

  const create = async (input: { name: string; aspectRatio: Project['aspectRatio'] }) => {
    try {
      const project = createProject(input)
      await saveProject(project)
      setNewOpen(false)
      navigate({ name: 'editor', projectId: project.id })
    } catch (error) {
      toast.error('Could not create the project', { description: errorMessage(error) })
    }
  }

  const rename = async (project: Project) => {
    const name = await promptText({ title: 'Rename project', label: 'Project name', initialValue: project.name, confirmLabel: 'Rename' })
    if (!name || name === project.name) return
    try {
      await renameProject(project.id, name)
      await refresh()
    } catch (error) {
      toast.error('Could not rename the project', { description: errorMessage(error) })
    }
  }

  const remove = async (project: Project) => {
    const ok = await confirm({
      title: `Delete “${project.name}”?`,
      description:
        'This permanently removes the project from this browser, along with any media that no other project uses. This cannot be undone.',
      confirmLabel: 'Delete project',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteProject(project.id)
      toast.success(`Deleted “${project.name}”`)
      await refresh()
    } catch (error) {
      toast.error('Could not delete the project', { description: errorMessage(error) })
    }
  }

  const duplicate = async (project: Project) => {
    try {
      await duplicateProject(project.id)
      toast.success('Project duplicated', { description: 'Media is shared between the copies, not stored twice.' })
      await refresh()
    } catch (error) {
      toast.error('Could not duplicate the project', { description: errorMessage(error) })
    }
  }

  const importFile = async (file: File) => {
    try {
      const { project, missingMedia } = await importProjectFile(file)
      toast.success(`Imported “${project.name}”`, {
        description: missingMedia
          ? `${missingMedia} media file${missingMedia === 1 ? ' is' : 's are'} not in this browser. Re-import ${missingMedia === 1 ? 'it' : 'them'} in the editor to relink.`
          : undefined,
      })
      await refresh()
    } catch (error) {
      toast.error('Could not import the file', { description: errorMessage(error) })
    }
  }

  const projects = state.status === 'ready' ? state.projects : []

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Logo />
          <span className="hidden text-sm text-muted-foreground sm:inline">Local-first video studio</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={() => importRef.current?.click()}>
              <FileUp /> <span className="hidden sm:inline">Import project file</span>
            </Button>
            <Button onClick={() => setNewOpen(true)} data-testid="new-project">
              <Plus /> New project
            </Button>
          </div>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="import-project-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importFile(file)
            }}
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className="mb-8">
          <PromptHero />
        </div>
        {state.status === 'loading' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading projects">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border">
                <Skeleton className="aspect-video rounded-none" />
                <div className="space-y-2 p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : state.status === 'error' ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Projects could not be loaded</EmptyTitle>
              <EmptyDescription>{state.message}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => void refresh()}>
                Try again
              </Button>
            </EmptyContent>
          </Empty>
        ) : projects.length === 0 ? (
          <Empty className="border py-16" data-testid="empty-projects">
            <EmptyHeader>
              <EmptyMedia>
                <span className="brand-gradient grid size-14 place-items-center rounded-2xl shadow-lg shadow-primary/30">
                  <Clapperboard className="size-7 text-white" />
                </span>
              </EmptyMedia>
              <EmptyTitle className="text-lg">Or start from your own media</EmptyTitle>
              <EmptyDescription>
                Turn photos, clips, a script and music into a polished MP4 — edited and rendered entirely on this device.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center gap-2">
              <Button onClick={() => setNewOpen(true)}>
                <Plus /> New project
              </Button>
              <Button variant="outline" onClick={() => importRef.current?.click()}>
                <FileUp /> Import project file
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-xl font-semibold tracking-tight">Projects</h2>
              <span className="text-sm text-muted-foreground">{projects.length} saved in this browser</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="project-grid">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onOpen={() => navigate({ name: 'editor', projectId: p.id })}
                  onRename={() => void rename(p)}
                  onDuplicate={() => void duplicate(p)}
                  onExportFile={() => void exportFile(p)}
                  onDelete={() => void remove(p)}
                />
              ))}
            </div>
          </>
        )}

        <div className="mt-10 grid gap-4 md:grid-cols-[1fr_minmax(0,22rem)]">
          <section className="rounded-xl border bg-card/60 p-4" aria-labelledby="privacy-heading">
            <h2 id="privacy-heading" className="flex items-center gap-2 text-sm font-medium">
              <Lock className="size-4 text-muted-foreground" /> Your media stays on this device
            </h2>
            <ul className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <li className="flex gap-2">
                <WifiOff className="mt-0.5 size-3.5 shrink-0" />
                Editing, previews and MP4 export run in your browser. Nothing is uploaded and there is no account.
              </li>
              <li className="flex gap-2">
                <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                Optional AI models are only downloaded when you ask, and run locally once downloaded.
              </li>
              <li className="flex gap-2">
                <FileUp className="mt-0.5 size-3.5 shrink-0" />
                Projects live in this browser's storage (not encrypted). Clearing site data deletes them — export project files as backups.
              </li>
            </ul>
          </section>
          <StorageCard refreshKey={storageKey} />
        </div>
      </main>

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} onCreate={create} />
    </div>
  )
}
