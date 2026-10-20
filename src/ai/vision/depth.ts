import { detectDeviceCapabilities } from '../capabilities'
import { DEPTH_CPU, DEPTH_GPU, type ModelManifest } from '../models'
import { isModelDownloaded } from '../modelStore'
import { getAnalyses, getAssetBlob, putAnalysis } from '@/storage/repo'
import { DEPTH_ANALYSIS_VERSION, type DepthAnalysis } from '@/storage/db'

/**
 * Main-thread API for depth analysis: picks the model variant for this device,
 * runs the worker, and caches results in IndexedDB (computed once per image,
 * shared by every project that uses it).
 */

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve(v: AnalysisResult): void; reject(e: Error): void }>()

interface AnalysisResult {
  width: number
  height: number
  depth: ArrayBuffer
  far: ArrayBuffer
  fill: ArrayBuffer
  bgDepth: ArrayBuffer
  hole: ArrayBuffer
  subject: number
  subjectBox: [number, number, number, number]
  ms: number
}

export async function depthModelForDevice(): Promise<ModelManifest> {
  const caps = await detectDeviceCapabilities()
  return caps.webgpu.available && caps.webgpu.shaderF16 ? DEPTH_GPU : DEPTH_CPU
}

export async function isDepthModelReady(): Promise<boolean> {
  return isModelDownloaded(await depthModelForDevice())
}

function ensureWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent) => {
    const msg = e.data as ({ type: 'result'; id: number } & AnalysisResult) | { type: 'error'; id: number; message: string }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.type === 'result') p.resolve(msg)
    else p.reject(new Error(msg.message))
  }
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The depth worker crashed.'))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  worker = w
  return w
}

/** Depth for an image asset, from cache or freshly computed. */
export async function analyzeDepth(assetId: string, options: { force?: boolean } = {}): Promise<DepthAnalysis> {
  if (!options.force) {
    const cached = (await getAnalyses([assetId])).get(assetId)
    if (cached) return cached
  }
  const manifest = await depthModelForDevice()
  if (!(await isModelDownloaded(manifest))) throw new Error('The depth model is not downloaded yet.')
  const blob = await getAssetBlob(assetId)
  // The model works at ~518 px; send a modest bitmap rather than a full-resolution photo.
  const full = await createImageBitmap(blob)
  const scale = Math.min(1, 1024 / Math.max(full.width, full.height))
  const bitmap =
    scale < 1
      ? await createImageBitmap(full, { resizeWidth: Math.round(full.width * scale), resizeHeight: Math.round(full.height * scale), resizeQuality: 'high' })
      : full
  if (bitmap !== full) full.close()
  const id = nextId++
  const result = await new Promise<AnalysisResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ensureWorker().postMessage({ type: 'analyze', id, bitmap, variant: manifest === DEPTH_GPU ? 'gpu' : 'cpu' }, [bitmap])
  })
  const record: DepthAnalysis = {
    assetId,
    width: result.width,
    height: result.height,
    depth: result.depth,
    far: result.far,
    fill: result.fill,
    bgDepth: result.bgDepth,
    hole: result.hole,
    subject: result.subject,
    subjectBox: result.subjectBox,
    version: DEPTH_ANALYSIS_VERSION,
    model: `${manifest.id}@${manifest.revision.slice(0, 7)}`,
    createdAt: Date.now(),
  }
  await putAnalysis(record)
  return record
}

export function stopDepthWorker(): void {
  worker?.terminate()
  worker = null
}
