import { errorMessage } from '@/lib/errors'
import { useEditorStore } from '@/state/editorStore'
import { saveProject } from '@/storage/repo'

const DEBOUNCE_MS = 700

/**
 * Debounced autosave of the open project to IndexedDB. Saves are serialized
 * (never two writes in flight), flushed immediately when the tab is hidden,
 * and the browser's "leave site?" prompt is shown if the last edit hasn't
 * been written yet.
 *
 * Returns a stop function that flushes any pending change.
 */
export function startAutosave(): () => Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let inflight: Promise<void> | null = null
  let queued = false

  const save = async (): Promise<void> => {
    const { project, revision, savedRevision } = useEditorStore.getState()
    if (!project || revision === savedRevision) return
    if (inflight) {
      queued = true
      return inflight
    }
    const store = useEditorStore.getState()
    store.markSaving()
    inflight = (async () => {
      try {
        await saveProject(project)
        useEditorStore.getState().markSaved(revision)
      } catch (error) {
        useEditorStore.getState().markSaveError(errorMessage(error))
      } finally {
        inflight = null
      }
    })()
    await inflight
    if (queued) {
      queued = false
      await save()
    }
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void save(), DEBOUNCE_MS)
  }

  const flush = () => {
    clearTimeout(timer)
    return save()
  }

  const unsubscribe = useEditorStore.subscribe((state, prev) => {
    if (state.revision !== prev.revision && state.project) schedule()
  })

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void flush()
  }
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    const { revision, savedRevision, project } = useEditorStore.getState()
    if (project && revision !== savedRevision) {
      void flush()
      event.preventDefault()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('beforeunload', onBeforeUnload)

  return async () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('beforeunload', onBeforeUnload)
    await flush()
  }
}

/** Retry a failed save right away (from the toolbar's error indicator). */
export async function retrySave(): Promise<void> {
  const { project, revision } = useEditorStore.getState()
  if (!project) return
  useEditorStore.getState().markSaving()
  try {
    await saveProject(project)
    useEditorStore.getState().markSaved(revision)
  } catch (error) {
    useEditorStore.getState().markSaveError(errorMessage(error))
  }
}
