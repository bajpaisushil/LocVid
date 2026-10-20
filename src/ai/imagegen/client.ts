/**
 * Main-thread handle to the image generation worker. One shared instance:
 * the loaded model (~3 GB of GPU memory) stays resident until unloaded.
 */

export interface GeneratedImage {
  blob: Blob
  ms: number
}

type Pending = { resolve(v: GeneratedImage): void; reject(e: Error): void }

class ImageGenClient {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private loadWaiters: { resolve(): void; reject(e: Error): void }[] = []
  private progressListeners = new Set<(detail: string, fraction: number) => void>()
  loaded = false

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./sdTurbo.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: 'progress'; detail: string; fraction: number }
        | { type: 'loaded' }
        | { type: 'unloaded' }
        | { type: 'image'; id: number; blob: Blob; ms: number }
        | { type: 'error'; id?: number; message: string }
      if (msg.type === 'progress') for (const l of this.progressListeners) l(msg.detail, msg.fraction)
      else if (msg.type === 'loaded') {
        this.loaded = true
        for (const w of this.loadWaiters.splice(0)) w.resolve()
      } else if (msg.type === 'image') {
        this.pending.get(msg.id)?.resolve({ blob: msg.blob, ms: msg.ms })
        this.pending.delete(msg.id)
      } else if (msg.type === 'error') {
        const error = new Error(msg.message)
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!.reject(error)
          this.pending.delete(msg.id)
        } else {
          for (const w of this.loadWaiters.splice(0)) w.reject(error)
        }
      }
    }
    worker.onerror = (e) => {
      const error = new Error(e.message || 'The image generation worker crashed (often a GPU memory problem).')
      for (const w of this.loadWaiters.splice(0)) w.reject(error)
      for (const p of this.pending.values()) p.reject(error)
      this.pending.clear()
      this.terminate()
    }
    this.worker = worker
    return worker
  }

  onProgress(listener: (detail: string, fraction: number) => void): () => void {
    this.progressListeners.add(listener)
    return () => this.progressListeners.delete(listener)
  }

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve()
    const worker = this.ensureWorker()
    return new Promise((resolve, reject) => {
      this.loadWaiters.push({ resolve, reject })
      worker.postMessage({ type: 'load' })
    })
  }

  /** Generate a picture; `size` (multiples of 64 px) defaults to the model's native 512×512. */
  generate(prompt: string, seed: number, size?: { width: number; height: number }): Promise<GeneratedImage> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ type: 'generate', id, prompt, seed, ...size })
    })
  }

  /** Free GPU memory by stopping the worker entirely. */
  terminate(): void {
    this.worker?.terminate()
    this.worker = null
    this.loaded = false
    for (const p of this.pending.values()) p.reject(new Error('Image generation was stopped.'))
    this.pending.clear()
  }
}

export const imageGen = new ImageGenClient()

/**
 * Picture size for a frame shape: about SD-Turbo's native pixel count (512²–
 * 1.3×), in multiples of 64, so a 16:9 or 9:16 video shows the whole picture
 * instead of a cropped middle.
 */
export function generationSize(aspect: '16:9' | '9:16' | '1:1'): { width: number; height: number } {
  if (aspect === '16:9') return { width: 768, height: 448 }
  if (aspect === '9:16') return { width: 448, height: 768 }
  return { width: 512, height: 512 }
}
