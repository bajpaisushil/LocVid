import { toast } from 'sonner'
import { create } from 'zustand'
import { analyzeDepth, depthModelForDevice } from '@/ai/vision/depth'
import { downloadModel, isModelDownloaded } from '@/ai/modelStore'
import type { ModelManifest } from '@/ai/models'
import { errorMessage, isAbortError } from '@/lib/errors'
import { getPreviewEngine } from '@/features/editor/previewRegistry'
import { getAnalyses } from '@/storage/repo'

type Status = 'unknown' | 'checking' | 'absent' | 'downloading' | 'ready'

interface DepthModelState {
  status: Status
  manifest: ModelManifest | null
  loaded: number
  total: number
  /** Asset ids currently being analyzed. */
  analyzing: Set<string>
  /** Whether each asset has a stored depth map (filled lazily). */
  analyzed: Record<string, boolean>
  refreshAnalyzed(assetIds: string[]): Promise<void>
  check(): Promise<void>
  download(): Promise<boolean>
  cancel(): void
  /** Analyze an image (downloading nothing: the model must be ready). Returns true on success. */
  analyze(assetId: string): Promise<boolean>
}

let controller: AbortController | null = null

/**
 * Shared state for the small, optional depth model (Depth Anything V2 Small,
 * Apache-2.0) that powers cinematic 3D motion.
 */
export const useDepthModel = create<DepthModelState>()((set, get) => ({
  status: 'unknown',
  manifest: null,
  loaded: 0,
  total: 0,
  analyzing: new Set(),
  analyzed: {},

  async refreshAnalyzed(assetIds) {
    if (assetIds.length === 0) return
    const found = await getAnalyses(assetIds)
    set((s) => {
      const next = { ...s.analyzed }
      for (const id of assetIds) next[id] = found.has(id)
      return { analyzed: next }
    })
  },

  async check() {
    if (get().status === 'downloading') return
    set({ status: 'checking' })
    const manifest = await depthModelForDevice()
    set({ manifest, status: (await isModelDownloaded(manifest)) ? 'ready' : 'absent' })
  },

  async download() {
    const manifest = get().manifest ?? (await depthModelForDevice())
    controller = new AbortController()
    set({ status: 'downloading', manifest, loaded: 0, total: manifest.files.reduce((n, f) => n + f.bytes, 0) })
    try {
      await downloadModel(manifest, (p) => set({ loaded: p.loaded, total: p.total }), controller.signal)
      set({ status: 'ready' })
      return true
    } catch (error) {
      set({ status: 'absent' })
      if (!isAbortError(error)) toast.error('Depth model download failed', { description: errorMessage(error) })
      return false
    } finally {
      controller = null
    }
  },

  cancel() {
    controller?.abort()
  },

  async analyze(assetId) {
    if (get().analyzing.has(assetId)) return false
    set((s) => ({ analyzing: new Set(s.analyzing).add(assetId) }))
    try {
      await analyzeDepth(assetId)
      getPreviewEngine()?.refreshDepth(assetId)
      set((s) => ({ analyzed: { ...s.analyzed, [assetId]: true } }))
      return true
    } catch (error) {
      toast.error('Depth analysis failed', { description: errorMessage(error) })
      return false
    } finally {
      set((s) => {
        const next = new Set(s.analyzing)
        next.delete(assetId)
        return { analyzing: next }
      })
    }
  },
}))
