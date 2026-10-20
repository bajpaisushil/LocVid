import { toast } from 'sonner'
import { create } from 'zustand'
import { analyzeCutout, areCutoutModelsReady, hasCutout } from '@/ai/vision/depth'
import { downloadModel, remainingBytes } from '@/ai/modelStore'
import { CUTOUT_MODELS, modelBytes } from '@/ai/models'
import { errorMessage, isAbortError } from '@/lib/errors'
import { getPreviewEngine } from '@/features/editor/previewRegistry'
import { getAnalyses } from '@/storage/repo'

type Status = 'unknown' | 'checking' | 'absent' | 'downloading' | 'ready'

/** Per picture: a subject was found and cut out, or the picture has no clear subject. */
export type CutoutResult = 'subject' | 'none'

interface CutoutModelState {
  status: Status
  loaded: number
  total: number
  analyzing: Set<string>
  results: Record<string, CutoutResult | undefined>
  /** Asset ids whose stored analysis has been looked up. */
  looked: Set<string>
  refresh(assetIds: string[]): Promise<void>
  check(): Promise<void>
  download(): Promise<boolean>
  cancel(): void
  /** Cut out an image's subject (models must be ready). Returns the result, or null on failure. */
  analyze(assetId: string): Promise<CutoutResult | null>
}

export const CUTOUT_BYTES = CUTOUT_MODELS.reduce((n, m) => n + modelBytes(m), 0)

let controller: AbortController | null = null

/**
 * Shared state for the optional subject cut-out models (IS-Net, Apache-2.0,
 * and MI-GAN, MIT) that let a picture's subject move on its own.
 */
export const useCutoutModels = create<CutoutModelState>()((set, get) => ({
  status: 'unknown',
  loaded: 0,
  total: CUTOUT_BYTES,
  analyzing: new Set(),
  results: {},
  looked: new Set(),

  async refresh(assetIds) {
    if (assetIds.length === 0) return
    const found = await getAnalyses(assetIds)
    set((s) => {
      const results = { ...s.results }
      const looked = new Set(s.looked)
      for (const id of assetIds) {
        const a = found.get(id)
        results[id] = hasCutout(a) ? (a?.cutout ? 'subject' : 'none') : undefined
        looked.add(id)
      }
      return { results, looked }
    })
  },

  async check() {
    if (get().status === 'downloading') return
    set({ status: 'checking' })
    set({ status: (await areCutoutModelsReady()) ? 'ready' : 'absent' })
  },

  async download() {
    controller = new AbortController()
    const signal = controller.signal
    set({ status: 'downloading', loaded: 0, total: CUTOUT_BYTES })
    try {
      // Files already downloaded count as done, so progress is continuous across both models.
      let base = 0
      for (const model of CUTOUT_MODELS) base += modelBytes(model) - (await remainingBytes(model))
      set({ loaded: base })
      for (const model of CUTOUT_MODELS) {
        const before = modelBytes(model) - (await remainingBytes(model))
        await downloadModel(model, (p) => set({ loaded: base + (p.loaded - before) }), signal)
        base += modelBytes(model) - before
      }
      set({ status: 'ready', loaded: CUTOUT_BYTES })
      return true
    } catch (error) {
      set({ status: 'absent' })
      if (!isAbortError(error)) toast.error('Cut-out model download failed', { description: errorMessage(error) })
      return false
    } finally {
      controller = null
    }
  },

  cancel() {
    controller?.abort()
  },

  async analyze(assetId) {
    if (get().analyzing.has(assetId)) return null
    set((s) => ({ analyzing: new Set(s.analyzing).add(assetId) }))
    try {
      const record = await analyzeCutout(assetId)
      getPreviewEngine()?.refreshDepth(assetId)
      const result: CutoutResult = record.cutout ? 'subject' : 'none'
      set((s) => ({ results: { ...s.results, [assetId]: result }, looked: new Set(s.looked).add(assetId) }))
      return result
    } catch (error) {
      toast.error('Could not cut out the subject', { description: errorMessage(error) })
      return null
    } finally {
      set((s) => {
        const next = new Set(s.analyzing)
        next.delete(assetId)
        return { analyzing: next }
      })
    }
  },
}))
