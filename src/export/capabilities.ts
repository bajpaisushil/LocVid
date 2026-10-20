import { createExportWorker } from './worker'

/**
 * What this browser can do for export, detected at runtime rather than assumed.
 */
export interface ExportCapabilities {
  /** WebCodecs H.264 encoding at the requested size (hardware where available). */
  h264: boolean
  /** WebCodecs AAC encoding (Chrome/Edge/Safari; not Firefox). */
  aac: boolean
  /** A worker can render (OffscreenCanvas 2D + FontFace) and encode. */
  workerRendering: boolean
  /** The worker can also use WebGL2 (cinematic effects); otherwise those exports render on the page. */
  workerWebGL: boolean
  offlineAudio: boolean
  webAssembly: boolean
  /** Approximate RAM in GB (Chromium only), null when unknown. */
  deviceMemory: number | null
  cores: number
}

let workerProbe: Promise<{ rendering: boolean; webgl: boolean }> | null = null

/** Spin up the export worker once and ask what it supports. */
export function probeWorker(): Promise<{ rendering: boolean; webgl: boolean }> {
  if (!workerProbe) {
    workerProbe = new Promise((resolve) => {
      let worker: Worker
      const none = { rendering: false, webgl: false }
      try {
        worker = createExportWorker()
      } catch {
        resolve(none)
        return
      }
      const timer = setTimeout(() => {
        worker.terminate()
        resolve(none)
      }, 5000)
      worker.onmessage = (e: MessageEvent) => {
        const r = e.data as { type: string; canvas2d?: boolean; fonts?: boolean; videoEncoder?: boolean; webgl2?: boolean }
        if (r.type !== 'probe-result') return
        clearTimeout(timer)
        worker.terminate()
        resolve({ rendering: !!(r.canvas2d && r.fonts && r.videoEncoder), webgl: !!r.webgl2 })
      }
      worker.onerror = () => {
        clearTimeout(timer)
        worker.terminate()
        resolve(none)
      }
      worker.postMessage({ type: 'probe' })
    })
  }
  return workerProbe
}

export async function detectExportCapabilities(width: number, height: number, fps: number, bitrate: number): Promise<ExportCapabilities> {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const base = {
    offlineAudio: typeof OfflineAudioContext !== 'undefined',
    webAssembly: typeof WebAssembly === 'object',
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: nav.hardwareConcurrency || 2,
  }
  if (typeof VideoEncoder === 'undefined') {
    return { ...base, h264: false, aac: false, workerRendering: false, workerWebGL: false }
  }
  const { canEncodeVideo, canEncodeAudio, Quality } = await import('mediabunny')
  const [h264, aac, worker] = await Promise.all([
    canEncodeVideo('avc', { width, height, quality: new Quality({ bitrate }), frameRate: fps }).catch(() => false),
    typeof AudioEncoder === 'undefined'
      ? Promise.resolve(false)
      : canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48_000, quality: new Quality({ bitrate: 160_000 }) }).catch(() => false),
    probeWorker(),
  ])
  return { ...base, h264, aac, workerRendering: worker.rendering, workerWebGL: worker.webgl }
}
