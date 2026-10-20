import type * as OrtTypes from 'onnxruntime-web'
import { CUTOUT_MODEL, DEPTH_CPU, DEPTH_GPU, INPAINT_MODEL, UPSCALE_MODEL, type ModelManifest } from '../models'
import { readModelFile } from '../modelStore'
import { configureOrt } from '../ortEnv'
import { actorDisparity, alignDepth, featherMask, groundDepth, layoutCutout, normalizeMatte, resampleNearest } from './cutoutPost'
import { rampWeight, tileGrid } from './tiles'
import { depthInputSize, farRegionMask, layeredDepth, luminanceGradient, normalizeDisparity, spreadTexture, subjectBox, subjectDisparity } from './depthPost'

/**
 * On-device vision models in a worker, with ONNX Runtime Web:
 *  - Depth Anything V2 (Small): WebGPU when available (fp16 model), otherwise
 *    WebAssembly on the CPU (int8 model);
 *  - IS-Net + MI-GAN "cut-out": the subject's matte and a clean background
 *    plate with the subject painted out, plus the plate's own depth;
 *  - RealPLKSR ×2: doubles a small picture's resolution (WebGPU).
 *   in:  { type: 'analyze' | 'cutout' | 'upscale', id, bitmap, ... }
 *   out: { type: 'result' | 'cutout' | 'upscaled', id, ... } | { type: 'error', id, message }
 */

interface Scope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent) => void) | null
}
const scope = self as unknown as Scope

type Variant = 'gpu' | 'cpu'
type Ort = typeof OrtTypes

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let ortPromise: Promise<Ort> | null = null
const sessions = new Map<string, Promise<OrtTypes.InferenceSession>>()

function loadOrt(): Promise<Ort> {
  ortPromise ??= import('onnxruntime-web/webgpu').then((ort) => {
    configureOrt(ort)
    return ort
  })
  return ortPromise
}

async function getSession(manifest: ModelManifest, ep: 'webgpu' | 'wasm'): Promise<{ ort: Ort; session: OrtTypes.InferenceSession }> {
  const ort = await loadOrt()
  const key = `${manifest.id}:${ep}`
  let pending = sessions.get(key)
  if (!pending) {
    pending = (async () => {
      const bytes = await (await readModelFile(manifest, manifest.files[0]!.path)).arrayBuffer()
      return ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all' })
    })()
    sessions.set(key, pending)
    pending.catch(() => sessions.delete(key))
  }
  return { ort, session: await pending }
}

function canvas2d(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

/** Relative disparity (normalized 16-bit) for a picture, at the model's resolution. */
async function estimateDepth(source: CanvasImageSource, srcWidth: number, srcHeight: number, variant: Variant) {
  const { ort, session } = await getSession(variant === 'gpu' ? DEPTH_GPU : DEPTH_CPU, variant === 'gpu' ? 'webgpu' : 'wasm')
  const size = depthInputSize(srcWidth, srcHeight)
  const { ctx } = canvas2d(size.width, size.height)
  ctx.drawImage(source, 0, 0, size.width, size.height)
  const { data } = ctx.getImageData(0, 0, size.width, size.height)
  const plane = size.width * size.height
  const input = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) input[c * plane + i] = (data[i * 4 + c]! / 255 - MEAN[c]!) / STD[c]!
  }
  const result = await session.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, size.height, size.width]) })
  const out = result.predicted_depth!
  const [, h, w] = out.dims as [number, number, number]
  const raw = (await out.getData()) as Float32Array
  out.dispose()
  // The model output matches the input size (multiples of 14), so the input pixels align with the depth map.
  const rgba = w === size.width && h === size.height ? data : ctx.getImageData(0, 0, w, h).data
  return { width: w, height: h, depth: normalizeDisparity(raw), rgba }
}

/** Sky / far-distance mask: far, smooth, and not right next to detail. */
function skyMask(depth: Uint16Array, rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const texture = spreadTexture(luminanceGradient(rgba, width, height), width, height, Math.max(2, Math.round(Math.max(width, height) * 0.012)))
  return farRegionMask(depth, width, height, 0.06, texture)
}

async function analyze(bitmap: ImageBitmap, variant: Variant) {
  const started = performance.now()
  const { width: w, height: h, depth, rgba } = await estimateDepth(bitmap, bitmap.width, bitmap.height, variant)
  bitmap.close()
  const far = skyMask(depth, rgba, w, h)
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

const SEGMENT_SIZE = 1024

interface CutoutRequest {
  bitmap: ImageBitmap
  variant: Variant
  segment: 'webgpu' | 'wasm'
  depth: { width: number; height: number; data: ArrayBuffer }
}

async function cutout({ bitmap, variant, segment, depth: original }: CutoutRequest) {
  const started = performance.now()
  const W = bitmap.width
  const H = bitmap.height
  const picture = canvas2d(W, H)
  picture.ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const pixels = picture.ctx.getImageData(0, 0, W, H).data

  // 1. Matte: IS-Net sees a 1024² square (normalized to -0.5..0.5) and predicts per-pixel saliency.
  const { ort, session: seg } = await getSession(CUTOUT_MODEL, segment)
  const square = canvas2d(SEGMENT_SIZE, SEGMENT_SIZE)
  square.ctx.drawImage(picture.canvas, 0, 0, SEGMENT_SIZE, SEGMENT_SIZE)
  const sq = square.ctx.getImageData(0, 0, SEGMENT_SIZE, SEGMENT_SIZE).data
  const plane = SEGMENT_SIZE * SEGMENT_SIZE
  const input = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) input[c * plane + i] = sq[i * 4 + c]! / 255 - 0.5
  const segOut = await seg.run({ input_image: new ort.Tensor('float32', input, [1, 3, SEGMENT_SIZE, SEGMENT_SIZE]) }, ['output_image'])
  const raw = (await segOut.output_image!.getData()) as Float32Array
  segOut.output_image!.dispose()
  const matteSquare = normalizeMatte(raw)
  const gray = new ImageData(SEGMENT_SIZE, SEGMENT_SIZE)
  for (let i = 0; i < plane; i++) {
    gray.data[i * 4] = gray.data[i * 4 + 1] = gray.data[i * 4 + 2] = matteSquare[i]!
    gray.data[i * 4 + 3] = 255
  }
  square.ctx.putImageData(gray, 0, 0)
  const resized = canvas2d(W, H)
  resized.ctx.drawImage(square.canvas, 0, 0, W, H)
  const resizedData = resized.ctx.getImageData(0, 0, W, H).data
  const matte = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) matte[i] = resizedData[i * 4]!

  const layout = layoutCutout(matte, W, H)
  if (!layout) return null
  // Only the actors stay in the matte (small salient bits remain part of the background).
  for (let i = 0; i < matte.length; i++) if (!layout.labels[i]) matte[i] = 0

  // 2. Clean plate: MI-GAN paints the background where the actors were (255 = keep, 0 = fill).
  const { session: inpaint } = await getSession(INPAINT_MODEL, 'wasm')
  const image = new Uint8Array(3 * W * H)
  const keep = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) image[c * W * H + i] = pixels[i * 4 + c]!
    keep[i] = layout.hole[i] ? 0 : 255
  }
  const filled = await inpaint.run({ image: new ort.Tensor('uint8', image, [1, 3, H, W]), mask: new ort.Tensor('uint8', keep, [1, 1, H, W]) })
  const rgb = (await filled.result!.getData()) as Uint8Array
  filled.result!.dispose()
  const plate = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) plate[i * 4 + c] = rgb[c * W * H + i]!
    plate[i * 4 + 3] = 255
  }
  const plateMask = featherMask(layout.hole, W, H, Math.max(1, Math.round(Math.max(W, H) / 400)))

  // 3. The plate's own depth (what's behind the actors), on the original's depth scale.
  const plateCanvas = canvas2d(W, H)
  plateCanvas.ctx.putImageData(new ImageData(plate, W, H), 0, 0)
  const est = await estimateDepth(plateCanvas.canvas, W, H, variant)
  const originalDepth = new Uint16Array(original.data)
  const holeOnDepth = resampleNearest(layout.hole, W, H, est.width, est.height)
  const sameGrid = est.width === original.width && est.height === original.height
  const plateDepth = sameGrid ? alignDepth(est.depth, originalDepth, (i) => !holeOnDepth[i]) : est.depth
  const plateFar = skyMask(plateDepth, est.rgba, est.width, est.height)
  const plateLayers = layeredDepth(est.rgba, plateDepth, est.width, est.height)
  for (const actor of layout.actors) {
    actor.depth = !actor.edges.bottom
      ? groundDepth(plateDepth, est.width, est.height, actor.anchor)
      : sameGrid
        ? actorDisparity(originalDepth, original.width, original.height, layout.labels, W, H, actor.label)
        : 0.6
  }
  // The main (largest) actor anchors the camera and the focus.
  const disparity = layout.actors[0]!.depth

  return {
    width: W,
    height: H,
    matte,
    labels: layout.labels,
    plate,
    plateMask,
    actors: layout.actors,
    disparity,
    plateDepth,
    plateFar,
    plateFill: plateLayers.fill,
    plateBgDepth: plateLayers.bgDepth,
    plateHole: plateLayers.hole,
    ms: performance.now() - started,
  }
}

const TILE = 512

/** Double a picture's resolution with the ×2 model: overlapping 512² tiles, blended across the overlaps. */
async function upscale(bitmap: ImageBitmap): Promise<Blob> {
  const { ort, session } = await getSession(UPSCALE_MODEL, 'webgpu')
  const W = bitmap.width
  const H = bitmap.height
  // Pictures smaller than a tile are edge-extended to one (the padding is cropped off again).
  const PW = Math.max(W, TILE)
  const PH = Math.max(H, TILE)
  const src = canvas2d(PW, PH)
  src.ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  if (PW > W) src.ctx.drawImage(src.canvas, W - 1, 0, 1, H, W, 0, PW - W, H)
  if (PH > H) src.ctx.drawImage(src.canvas, 0, H - 1, PW, 1, 0, H, PW, PH - H)
  const pixels = src.ctx.getImageData(0, 0, PW, PH).data
  const OW = PW * 2
  const OH = PH * 2
  const out = TILE * 2
  const acc = new Float32Array(OW * OH * 3)
  const weights = new Float32Array(OW * OH)
  const plane = TILE * TILE
  for (const tile of tileGrid(PW, PH, TILE, 48)) {
    const input = new Float32Array(plane * 3)
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const s = ((tile.y + y) * PW + tile.x + x) * 4
        const d = y * TILE + x
        for (let c = 0; c < 3; c++) input[c * plane + d] = pixels[s + c]! / 255
      }
    }
    const result = await session.run({ input: new ort.Tensor('float32', input, [1, 3, TILE, TILE]) })
    const data = (await result.output!.getData()) as Float32Array
    result.output!.dispose()
    const oplane = out * out
    for (let y = 0; y < out; y++) {
      const wy = rampWeight(y, tile.y * 2, out, OH, 96)
      for (let x = 0; x < out; x++) {
        const w = wy * rampWeight(x, tile.x * 2, out, OW, 96)
        const o = (tile.y * 2 + y) * OW + tile.x * 2 + x
        const i = y * out + x
        for (let c = 0; c < 3; c++) acc[o * 3 + c] = acc[o * 3 + c]! + data[c * oplane + i]! * w
        weights[o] = weights[o]! + w
      }
    }
  }
  const rgba = new Uint8ClampedArray(W * 2 * H * 2 * 4)
  for (let y = 0; y < H * 2; y++) {
    for (let x = 0; x < W * 2; x++) {
      const o = y * OW + x
      const d = (y * W * 2 + x) * 4
      for (let c = 0; c < 3; c++) rgba[d + c] = (acc[o * 3 + c]! / weights[o]!) * 255
      rgba[d + 3] = 255
    }
  }
  const canvas = new OffscreenCanvas(W * 2, H * 2)
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, W * 2, H * 2), 0, 0)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.94 })
}

scope.onmessage = async (event: MessageEvent) => {
  const msg = event.data as
    | { type: 'analyze'; id: number; bitmap: ImageBitmap; variant: Variant }
    | ({ type: 'cutout'; id: number } & CutoutRequest)
    | { type: 'upscale'; id: number; bitmap: ImageBitmap }
  try {
    if (msg.type === 'analyze') {
      const r = await analyze(msg.bitmap, msg.variant)
      const buffers = [r.depth.buffer, r.far.buffer, r.fill.buffer, r.bgDepth.buffer, r.hole.buffer] as ArrayBuffer[]
      scope.postMessage(
        { type: 'result', id: msg.id, ...r, depth: r.depth.buffer, far: r.far.buffer, fill: r.fill.buffer, bgDepth: r.bgDepth.buffer, hole: r.hole.buffer },
        buffers,
      )
    } else if (msg.type === 'upscale') {
      scope.postMessage({ type: 'upscaled', id: msg.id, blob: await upscale(msg.bitmap) })
    } else if (msg.type === 'cutout') {
      const r = await cutout(msg)
      if (!r) {
        scope.postMessage({ type: 'cutout', id: msg.id, none: true })
        return
      }
      const buffers = {
        matte: r.matte.buffer,
        labels: r.labels.buffer,
        plate: r.plate.buffer,
        plateMask: r.plateMask.buffer,
        plateDepth: r.plateDepth.buffer,
        plateFar: r.plateFar.buffer,
        plateFill: r.plateFill.buffer,
        plateBgDepth: r.plateBgDepth.buffer,
        plateHole: r.plateHole.buffer,
      } as Record<string, ArrayBuffer>
      scope.postMessage({ type: 'cutout', id: msg.id, ...r, ...buffers }, Object.values(buffers))
    }
  } catch (error) {
    scope.postMessage({ type: 'error', id: msg.id, message: error instanceof Error ? error.message : String(error) })
  }
}
