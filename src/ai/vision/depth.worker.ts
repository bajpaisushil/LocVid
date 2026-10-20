import type * as OrtTypes from 'onnxruntime-web'
import { DEPTH_CPU, DEPTH_GPU, type ModelManifest } from '../models'
import { readModelFile } from '../modelStore'
import { depthInputSize, farRegionMask, layeredDepth, luminanceGradient, normalizeDisparity, subjectBox, subjectDisparity } from './depthPost'

/**
 * Depth Anything V2 (Small) in a worker with ONNX Runtime Web — WebGPU when
 * available (fp16 model), otherwise WebAssembly on the CPU (int8 model).
 *   in:  { type: 'analyze', id, bitmap: ImageBitmap, variant: 'gpu' | 'cpu' }
 *   out: { type: 'result', id, width, height, depth, far, subject, ms } | { type: 'error', id, message }
 */

interface Scope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent) => void) | null
}
const scope = self as unknown as Scope

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let session: { variant: 'gpu' | 'cpu'; session: OrtTypes.InferenceSession; ort: typeof OrtTypes } | null = null

async function getSession(variant: 'gpu' | 'cpu') {
  if (session?.variant === variant) return session
  const ort = await import('onnxruntime-web/webgpu')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  const manifest: ModelManifest = variant === 'gpu' ? DEPTH_GPU : DEPTH_CPU
  const bytes = await (await readModelFile(manifest, manifest.files[0]!.path)).arrayBuffer()
  const s = await ort.InferenceSession.create(bytes, {
    executionProviders: variant === 'gpu' ? ['webgpu'] : ['wasm'],
    graphOptimizationLevel: 'all',
  })
  session = { variant, session: s, ort }
  return session
}

async function analyze(bitmap: ImageBitmap, variant: 'gpu' | 'cpu') {
  const started = performance.now()
  const { session: s, ort } = await getSession(variant)
  const size = depthInputSize(bitmap.width, bitmap.height)
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()
  const { data } = ctx.getImageData(0, 0, size.width, size.height)
  const plane = size.width * size.height
  const input = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) input[c * plane + i] = (data[i * 4 + c]! / 255 - MEAN[c]!) / STD[c]!
  }
  const result = await s.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, size.height, size.width]) })
  const out = result.predicted_depth!
  const [, h, w] = out.dims as [number, number, number]
  const raw = (await out.getData()) as Float32Array
  out.dispose()
  const depth = normalizeDisparity(raw)
  // The model output matches the input size (multiples of 14), so the input pixels align with the depth map.
  const rgba = w === size.width && h === size.height ? data : ctx.getImageData(0, 0, w, h).data
  const far = farRegionMask(depth, w, h, 0.06, luminanceGradient(rgba, w, h))
  const layered = layeredDepth(rgba, depth, w, h)
  const subject = subjectDisparity(depth, w, h)
  return {
    width: w,
    height: h,
    depth,
    far,
    fill: layered.fill,
    bgDepth: layered.bgDepth,
    hole: layered.hole,
    subject,
    subjectBox: subjectBox(depth, w, h, subject),
    ms: performance.now() - started,
  }
}

scope.onmessage = async (event: MessageEvent) => {
  const msg = event.data as { type: string; id: number; bitmap: ImageBitmap; variant: 'gpu' | 'cpu' }
  if (msg.type !== 'analyze') return
  try {
    const r = await analyze(msg.bitmap, msg.variant)
    const buffers = [r.depth.buffer, r.far.buffer, r.fill.buffer, r.bgDepth.buffer, r.hole.buffer] as ArrayBuffer[]
    scope.postMessage(
      { type: 'result', id: msg.id, ...r, depth: r.depth.buffer, far: r.far.buffer, fill: r.fill.buffer, bgDepth: r.bgDepth.buffer, hole: r.hole.buffer },
      buffers,
    )
  } catch (error) {
    scope.postMessage({ type: 'error', id: msg.id, message: error instanceof Error ? error.message : String(error) })
  }
}
