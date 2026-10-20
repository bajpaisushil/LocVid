import type { FFmpeg } from '@ffmpeg/ffmpeg'
import { ExportError } from './types'

/**
 * FFmpeg.wasm (single-threaded core, GPL — bundles x264) loaded lazily on
 * first use from the app's own origin. It runs in its own Web Worker. The
 * ~31 MB core is fetched once and then served from the browser cache.
 *
 * Set VITE_FFMPEG_BASE_URL at build time to load the core from elsewhere
 * (e.g. when a static host limits file sizes).
 */

let loading: Promise<FFmpeg> | null = null
let instance: FFmpeg | null = null
const logTail: string[] = []

export const FFMPEG_CORE_SIZE_MB = 31

async function coreUrls(): Promise<{ coreURL: string; wasmURL: string }> {
  const base = import.meta.env.VITE_FFMPEG_BASE_URL as string | undefined
  if (base) {
    const b = base.replace(/\/$/, '')
    return { coreURL: `${b}/ffmpeg-core.js`, wasmURL: `${b}/ffmpeg-core.wasm` }
  }
  const [{ default: coreURL }, { default: wasmURL }] = await Promise.all([
    import('@ffmpeg/core?url'),
    import('@ffmpeg/core/wasm?url'),
  ])
  return { coreURL: new URL(coreURL, location.href).href, wasmURL: new URL(wasmURL, location.href).href }
}

/** Download with real byte progress (so the UI never shows a fake bar). */
async function fetchWithProgress(url: string, onProgress?: (loaded: number, total: number) => void): Promise<string> {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} loading ${url}`)
  const total = Number(response.headers.get('content-length')) || FFMPEG_CORE_SIZE_MB * 1024 * 1024
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress?.(loaded, total)
  }
  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type: 'application/wasm' }))
}

export function loadFFmpeg(onProgress?: (fraction: number) => void): Promise<FFmpeg> {
  if (instance) return Promise.resolve(instance)
  if (!loading) {
    loading = (async () => {
      try {
        const { FFmpeg } = await import('@ffmpeg/ffmpeg')
        const { coreURL, wasmURL } = await coreUrls()
        const wasmBlobUrl = await fetchWithProgress(wasmURL, (l, t) => onProgress?.(Math.min(0.99, l / t)))
        const ffmpeg = new FFmpeg()
        ffmpeg.on('log', ({ message }) => {
          logTail.push(message)
          if (logTail.length > 40) logTail.shift()
        })
        try {
          await ffmpeg.load({ coreURL, wasmURL: wasmBlobUrl })
        } finally {
          URL.revokeObjectURL(wasmBlobUrl)
        }
        onProgress?.(1)
        instance = ffmpeg
        return ffmpeg
      } catch (error) {
        loading = null
        throw new ExportError(
          'ffmpeg',
          'FFmpeg.wasm could not be loaded.',
          'Check that the app files are fully available (or online access to the app’s own server for the first load), then try again.',
          { cause: error },
        )
      }
    })()
  }
  return loading
}

/** Stop FFmpeg immediately (used for cancellation); the next export reloads it. */
export function terminateFFmpeg(): void {
  instance?.terminate()
  instance = null
  loading = null
}

export async function runFFmpeg(ffmpeg: FFmpeg, args: string[], onProgress?: (fraction: number) => void): Promise<void> {
  logTail.length = 0
  const handler = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)))
  ffmpeg.on('progress', handler)
  try {
    const code = await ffmpeg.exec(args)
    if (code !== 0) {
      const detail = logTail.filter((l) => /error|invalid|failed|not|unable/i.test(l)).slice(-3).join(' · ')
      throw new ExportError('ffmpeg', `FFmpeg failed (exit code ${code})${detail ? `: ${detail}` : ''}.`)
    }
  } finally {
    ffmpeg.off('progress', handler)
  }
}

export async function removeFiles(ffmpeg: FFmpeg, names: string[]): Promise<void> {
  for (const name of names) await ffmpeg.deleteFile(name).catch(() => undefined)
}

export function isFFmpegLoaded(): boolean {
  return instance !== null
}
