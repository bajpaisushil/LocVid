import { fileUrl, modelBytes, type ModelManifest } from './models'

/**
 * Model files live in Cache Storage (separate from projects), downloaded only
 * on explicit request. Each file is streamed straight to disk with byte-level
 * progress, then its size is verified against the pinned manifest. These are
 * the only requests LocVid ever makes to another host, and they carry no
 * user data (plain GETs, no cookies).
 */

const CACHE_NAME = 'locvid-models-v1'

export interface DownloadProgress {
  loaded: number
  total: number
  file: string
}

function hasCacheStorage(): boolean {
  return typeof caches !== 'undefined'
}

export async function downloadedFiles(model: ModelManifest): Promise<Set<string>> {
  const present = new Set<string>()
  if (!hasCacheStorage()) return present
  const cache = await caches.open(CACHE_NAME)
  for (const file of model.files) {
    if (await cache.match(fileUrl(model, file))) present.add(file.path)
  }
  return present
}

export async function isModelDownloaded(model: ModelManifest): Promise<boolean> {
  return (await downloadedFiles(model)).size === model.files.length
}

/** Bytes still to download (resumes per file). */
export async function remainingBytes(model: ModelManifest): Promise<number> {
  const present = await downloadedFiles(model)
  return model.files.filter((f) => !present.has(f.path)).reduce((n, f) => n + f.bytes, 0)
}

export class ModelDownloadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ModelDownloadError'
  }
}

/** How long a download may go without receiving any data before it counts as stalled. */
export const STALL_MS = 45_000

/** Aborts its signal when `poke()` hasn't been called for `ms` milliseconds. */
export class StallWatch {
  readonly signal: AbortSignal
  fired = false
  private readonly controller = new AbortController()
  private readonly ms: number
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(ms: number) {
    this.ms = ms
    this.signal = this.controller.signal
    this.poke()
  }

  poke(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.fired = true
      this.controller.abort(new DOMException('Download stalled', 'TimeoutError'))
    }, this.ms)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

/** A signal that aborts when any of `signals` does (AbortSignal.any where available). */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if ('any' in AbortSignal) return (AbortSignal as unknown as { any(s: AbortSignal[]): AbortSignal }).any(signals)
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason)
      break
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true })
  }
  return controller.signal
}

export async function downloadModel(model: ModelManifest, onProgress: (p: DownloadProgress) => void, signal: AbortSignal): Promise<void> {
  if (!hasCacheStorage()) throw new ModelDownloadError('This browser does not support Cache Storage, so models cannot be stored.')
  const cache = await caches.open(CACHE_NAME)
  const total = modelBytes(model)
  const present = await downloadedFiles(model)
  let done = model.files.filter((f) => present.has(f.path)).reduce((n, f) => n + f.bytes, 0)

  // Make sure the browser will let us store it.
  const missing = total - done
  try {
    const est = await navigator.storage?.estimate?.()
    if (est?.quota !== undefined && est.usage !== undefined && est.quota - est.usage < missing * 1.1) {
      throw new ModelDownloadError(
        `Not enough browser storage: the model needs ${(missing / 1e9).toFixed(1)} GB but only ${((est.quota - est.usage) / 1e9).toFixed(1)} GB is available to this site.`,
      )
    }
  } catch (error) {
    if (error instanceof ModelDownloadError) throw error
  }

  for (const file of model.files) {
    if (present.has(file.path)) continue
    const url = fileUrl(model, file)
    // A connection can stall without erroring; give up on a file that sends nothing for a while.
    const stall = new StallWatch(STALL_MS)
    const fileSignal = anySignal([signal, stall.signal])
    const stalledError = () =>
      new ModelDownloadError(`The download of ${file.path} stalled (no data for ${STALL_MS / 1000} s). Check your connection and try again; finished files are kept.`)
    let response: Response
    try {
      response = await fetch(url, { signal: fileSignal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    } catch (error) {
      stall.stop()
      if (signal.aborted) throw error
      if (stall.fired) throw stalledError()
      throw new ModelDownloadError(`Network error while downloading ${file.path}. Check your connection and try again; finished files are kept.`, { cause: error })
    }
    if (!response.ok || !response.body) {
      stall.stop()
      throw new ModelDownloadError(`Download of ${file.path} failed (HTTP ${response.status}).`)
    }
    let loaded = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        stall.poke()
        loaded += chunk.byteLength
        onProgress({ loaded: done + loaded, total, file: file.path })
        controller.enqueue(chunk)
      },
    })
    try {
      // Streamed into the cache — the file never has to fit in memory. A failed or aborted put stores nothing.
      await cache.put(url, new Response(response.body.pipeThrough(counter, { signal: fileSignal }), { headers: { 'content-type': 'application/octet-stream' } }))
    } catch (error) {
      if (signal.aborted) throw error
      if (stall.fired) throw stalledError()
      throw new ModelDownloadError(
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? 'Browser storage filled up during the download. Free some space and try again.'
          : `Saving ${file.path} failed: ${(error as Error).message}`,
        { cause: error },
      )
    } finally {
      stall.stop()
    }
    const stored = await cache.match(url)
    const size = stored ? (await stored.blob()).size : 0
    if (size !== file.bytes) {
      await cache.delete(url)
      throw new ModelDownloadError(`${file.path} arrived incomplete (${size} of ${file.bytes} bytes). Please try again.`)
    }
    done += file.bytes
    onProgress({ loaded: done, total, file: file.path })
  }
}

export async function deleteModel(model: ModelManifest): Promise<void> {
  if (!hasCacheStorage()) return
  const cache = await caches.open(CACHE_NAME)
  for (const file of model.files) await cache.delete(fileUrl(model, file))
}

/** Read a cached model file (used by the generation worker). */
export async function readModelFile(model: ModelManifest, path: string): Promise<Response> {
  const file = model.files.find((f) => f.path === path)
  if (!file) throw new Error(`Unknown model file ${path}`)
  const cache = await caches.open(CACHE_NAME)
  const response = await cache.match(fileUrl(model, file))
  if (!response) throw new ModelDownloadError(`${path} is not downloaded.`)
  return response
}
