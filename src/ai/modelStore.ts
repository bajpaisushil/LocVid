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
    let response: Response
    try {
      response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    } catch (error) {
      if (signal.aborted) throw error
      throw new ModelDownloadError(`Network error while downloading ${file.path}. Check your connection and try again; finished files are kept.`, { cause: error })
    }
    if (!response.ok || !response.body) throw new ModelDownloadError(`Download of ${file.path} failed (HTTP ${response.status}).`)
    let loaded = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength
        onProgress({ loaded: done + loaded, total, file: file.path })
        controller.enqueue(chunk)
      },
    })
    try {
      // Streamed into the cache — the file never has to fit in memory. A failed or aborted put stores nothing.
      await cache.put(url, new Response(response.body.pipeThrough(counter, { signal }), { headers: { 'content-type': 'application/octet-stream' } }))
    } catch (error) {
      if (signal.aborted) throw error
      throw new ModelDownloadError(
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? 'Browser storage filled up during the download. Free some space and try again.'
          : `Saving ${file.path} failed: ${(error as Error).message}`,
        { cause: error },
      )
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
