import { detectDeviceCapabilities } from '../capabilities'
import { CUTOUT_MODEL, CUTOUT_MODELS, DEPTH_CPU, DEPTH_GPU, type ModelManifest } from '../models'
import { isModelDownloaded } from '../modelStore'
import { getAnalyses, getAssetBlob, putAnalysis } from '@/storage/repo'
import { CUTOUT_VERSION, DEPTH_ANALYSIS_VERSION, type CutoutActor, type DepthAnalysis, type SubjectCutout } from '@/storage/db'

/**
 * Main-thread API for on-device vision: picks the model variant for this
 * device, runs the worker, and caches results in IndexedDB (computed once per
 * image, shared by every project that uses it).
 */

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()

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

type CutoutResult =
  | { none: true }
  | (Omit<SubjectCutout, 'version' | 'model' | 'actors'> & { none?: undefined; actors: CutoutActor[]; ms: number })

export async function depthModelForDevice(): Promise<ModelManifest> {
  const caps = await detectDeviceCapabilities()
  return caps.webgpu.available && caps.webgpu.shaderF16 ? DEPTH_GPU : DEPTH_CPU
}

export async function isDepthModelReady(): Promise<boolean> {
  return isModelDownloaded(await depthModelForDevice())
}

export async function areCutoutModelsReady(): Promise<boolean> {
  for (const m of CUTOUT_MODELS) if (!(await isModelDownloaded(m))) return false
  return true
}

function ensureWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent) => {
    const msg = e.data as { type: 'result' | 'cutout' | 'error'; id: number; message?: string }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.type === 'error') p.reject(new Error(msg.message))
    else p.resolve(msg)
  }
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The vision worker crashed.'))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  worker = w
  return w
}

function request<T>(message: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    ensureWorker().postMessage({ ...message, id }, transfer)
  })
}

/** The models work at ≤1024 px; send a modest bitmap rather than a full-resolution photo. */
async function analysisBitmap(assetId: string): Promise<ImageBitmap> {
  const blob = await getAssetBlob(assetId)
  const full = await createImageBitmap(blob)
  const scale = Math.min(1, 1024 / Math.max(full.width, full.height))
  if (scale >= 1) return full
  const bitmap = await createImageBitmap(full, { resizeWidth: Math.round(full.width * scale), resizeHeight: Math.round(full.height * scale), resizeQuality: 'high' })
  full.close()
  return bitmap
}

/** Depth for an image asset, from cache or freshly computed. */
export async function analyzeDepth(assetId: string, options: { force?: boolean } = {}): Promise<DepthAnalysis> {
  const cached = (await getAnalyses([assetId])).get(assetId)
  if (cached && !options.force) return cached
  const manifest = await depthModelForDevice()
  if (!(await isModelDownloaded(manifest))) throw new Error('The depth model is not downloaded yet.')
  const bitmap = await analysisBitmap(assetId)
  const result = await request<AnalysisResult>({ type: 'analyze', bitmap, variant: manifest === DEPTH_GPU ? 'gpu' : 'cpu' }, [bitmap])
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

/** Whether an analysis already holds a current cut-out result (a subject, or "no clear subject"). */
export function hasCutout(analysis: DepthAnalysis | null | undefined): boolean {
  return analysis?.cutout === null || analysis?.cutout?.version === CUTOUT_VERSION
}

/**
 * Separate an image's subject(s) from the background and paint a clean plate
 * behind them (for subject animation). Computes depth first if needed. The
 * result is stored with the depth analysis; `cutout: null` means the picture
 * has no clear subject to animate.
 */
export async function analyzeCutout(assetId: string, options: { force?: boolean } = {}): Promise<DepthAnalysis> {
  const analysis = await analyzeDepth(assetId)
  if (hasCutout(analysis) && !options.force) return analysis
  if (!(await areCutoutModelsReady())) throw new Error('The cut-out models are not downloaded yet.')
  const [depthManifest, caps] = await Promise.all([depthModelForDevice(), detectDeviceCapabilities()])
  const bitmap = await analysisBitmap(assetId)
  const message = {
    type: 'cutout',
    bitmap,
    variant: depthManifest === DEPTH_GPU ? 'gpu' : 'cpu',
    // IS-Net is fp32 with plain convolutions: any WebGPU device runs it; otherwise the CPU does (slower).
    segment: caps.webgpu.available ? 'webgpu' : 'wasm',
    depth: { width: analysis.width, height: analysis.height, data: analysis.depth.slice(0) },
  }
  let result: CutoutResult
  try {
    result = await request<CutoutResult>(message, [bitmap])
  } catch (error) {
    if (message.segment !== 'webgpu') throw error
    // A GPU that can't run the model (memory, driver limits): retry on the CPU.
    const retry = await analysisBitmap(assetId)
    result = await request<CutoutResult>({ ...message, bitmap: retry, segment: 'wasm', depth: { ...message.depth, data: analysis.depth.slice(0) } }, [retry])
  }
  const record: DepthAnalysis = {
    ...analysis,
    cutout: result.none
      ? null
      : {
          version: CUTOUT_VERSION,
          model: `${CUTOUT_MODEL.id}@${CUTOUT_MODEL.revision.slice(0, 7)}`,
          width: result.width,
          height: result.height,
          matte: result.matte,
          labels: result.labels,
          plate: result.plate,
          plateMask: result.plateMask,
          actors: result.actors,
          disparity: result.disparity,
          plateDepth: result.plateDepth,
          plateFar: result.plateFar,
          plateFill: result.plateFill,
          plateBgDepth: result.plateBgDepth,
          plateHole: result.plateHole,
        },
  }
  await putAnalysis(record)
  return record
}

export function stopDepthWorker(): void {
  worker?.terminate()
  worker = null
}
