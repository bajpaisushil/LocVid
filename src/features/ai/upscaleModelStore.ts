import { toast } from 'sonner'
import { create } from 'zustand'
import { canUpscale, isUpscaleModelReady } from '@/ai/vision/depth'
import { downloadModel } from '@/ai/modelStore'
import { modelBytes, UPSCALE_MODEL } from '@/ai/models'
import { errorMessage, isAbortError } from '@/lib/errors'

type Status = 'unknown' | 'checking' | 'unsupported' | 'absent' | 'downloading' | 'ready'

interface UpscaleModelState {
  status: Status
  loaded: number
  total: number
  check(): Promise<void>
  download(): Promise<boolean>
  cancel(): void
}

export const UPSCALE_BYTES = modelBytes(UPSCALE_MODEL)

let controller: AbortController | null = null

/** Download state of the optional ×2 sharpening model (RealPLKSR, MIT; WebGPU only). */
export const useUpscaleModel = create<UpscaleModelState>()((set, get) => ({
  status: 'unknown',
  loaded: 0,
  total: UPSCALE_BYTES,

  async check() {
    if (get().status === 'downloading') return
    set({ status: 'checking' })
    if (!(await canUpscale())) return set({ status: 'unsupported' })
    set({ status: (await isUpscaleModelReady()) ? 'ready' : 'absent' })
  },

  async download() {
    controller = new AbortController()
    set({ status: 'downloading', loaded: 0, total: UPSCALE_BYTES })
    try {
      await downloadModel(UPSCALE_MODEL, (p) => set({ loaded: p.loaded, total: p.total }), controller.signal)
      set({ status: 'ready' })
      return true
    } catch (error) {
      set({ status: 'absent' })
      if (!isAbortError(error)) toast.error('Sharpening model download failed', { description: errorMessage(error) })
      return false
    } finally {
      controller = null
    }
  },

  cancel() {
    controller?.abort()
  },
}))
