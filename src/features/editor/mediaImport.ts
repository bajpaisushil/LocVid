import { toast } from 'sonner'
import { create } from 'zustand'
import { createScene } from '@/core/defaults'
import { addAssetIds, addScenes } from '@/core/operations'
import type { AssetMeta } from '@/core/types'
import { importFiles, type ImportFailure, type ImportOptions } from '@/media/importer'
import { useEditorStore } from '@/state/editorStore'

interface ImportState {
  active: boolean
  index: number
  total: number
  fileName: string
}

export const useImportStore = create<ImportState>(() => ({ active: false, index: 0, total: 0, fileName: '' }))

let queue: Promise<unknown> = Promise.resolve()

/** Add visual assets to the end of the timeline as one scene each (one undo step). */
export function addAssetsAsScenes(assets: AssetMeta[]): void {
  const visual = assets.filter((a) => a.kind !== 'audio')
  if (visual.length === 0) return
  const { apply, project } = useEditorStore.getState()
  if (!project) return
  const startIndex = project.scenes.length
  const scenes = visual.map((asset, i) => createScene({ index: startIndex + i, asset }))
  apply((d) => addScenes(d, scenes), { select: { kind: 'scene', sceneId: scenes[0]!.id } })
}

function describeFailures(failed: ImportFailure[]): string {
  const lines = failed.slice(0, 4).map((f) => `${f.fileName}: ${f.message}`)
  if (failed.length > 4) lines.push(`…and ${failed.length - 4} more`)
  return lines.join('\n')
}

/**
 * Import files into the open project's media bin. Imports are queued so
 * several drops in a row are processed one file at a time.
 */
export function importIntoProject(
  files: readonly File[],
  options: { asScenes?: boolean; quiet?: boolean } & ImportOptions = {},
): Promise<AssetMeta[]> {
  if (files.length === 0) return Promise.resolve([])
  const run = queue.then(async (): Promise<AssetMeta[]> => {
    const editor = useEditorStore.getState()
    if (!editor.project) return []
    useImportStore.setState({ active: true, index: 0, total: files.length, fileName: files[0]?.name ?? '' })
    try {
      const { imported, failed } = await importFiles(
        files,
        (p) => useImportStore.setState({ index: p.index, total: p.total, fileName: p.fileName }),
        (asset) => useEditorStore.getState().registerAsset(asset.meta, asset.thumbnail),
        { origin: options.origin, generator: options.generator },
      )
      if (imported.length > 0) {
        useEditorStore.getState().apply((d) => addAssetIds(d, imported.map((a) => a.meta.id)))
      }
      const metas = imported.map((a) => a.meta)
      const visual = metas.filter((m) => m.kind !== 'audio')
      if (options.asScenes) addAssetsAsScenes(metas)

      if (imported.length > 0 && !options.quiet) {
        const reused = imported.filter((a) => a.reused).length
        const project = useEditorStore.getState().project
        const offerScenes = !options.asScenes && visual.length > 0
        toast.success(`Imported ${imported.length} file${imported.length === 1 ? '' : 's'}`, {
          description: [
            reused ? `${reused} already stored — reused without duplicating.` : null,
            failed.length ? `${failed.length} skipped:\n${describeFailures(failed)}` : null,
          ]
            .filter(Boolean)
            .join('\n') || undefined,
          action: offerScenes
            ? {
                label: project && project.scenes.length === 0 ? 'Create scenes' : `Add ${visual.length} as scenes`,
                onClick: () => addAssetsAsScenes(visual),
              }
            : undefined,
          duration: offerScenes ? 8000 : 4000,
        })
      } else if (failed.length > 0) {
        toast.error(`Could not import ${failed.length === 1 ? failed[0]!.fileName : `${failed.length} files`}`, {
          description: failed.length === 1 ? failed[0]!.message : describeFailures(failed),
          duration: 8000,
        })
      }
      return metas
    } finally {
      useImportStore.setState({ active: false, index: 0, total: 0, fileName: '' })
    }
  })
  queue = run.catch(() => undefined)
  return run
}
