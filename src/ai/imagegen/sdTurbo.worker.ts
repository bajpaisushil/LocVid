import type * as OrtTypes from 'onnxruntime-web'
import { createRng } from '@/lib/math'
import { ClipTokenizer } from './clipTokenizer'
import { SD_TURBO } from '../models'
import { readModelFile } from '../modelStore'
import { configureOrt } from '../ortEnv'

/**
 * SD-Turbo text-to-image on WebGPU via ONNX Runtime Web, in a worker so the
 * editor stays responsive. Pipeline (single denoising step):
 *   CLIP tokenizer → text encoder → UNet @ t=999 → Euler step → VAE decoder.
 * Messages:
 *   in:  { type: 'load' } | { type: 'generate', id, prompt, seed, width?, height? } | { type: 'unload' }
 *   out: { type: 'progress', detail, fraction } | { type: 'loaded' } |
 *        { type: 'image', id, blob, ms } | { type: 'error', id?, message }
 */

interface Scope {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent) => void) | null
}
const scope = self as unknown as Scope

type Ort = typeof OrtTypes
type Session = OrtTypes.InferenceSession

const SIGMA = 14.6146
const VAE_SCALING = 0.18215

let ort: Ort | null = null
let sessions: { text: Session; unet: Session; vae: Session } | null = null
/** Latent size the UNet and VAE sessions are specialized for (shapes are fixed per session for speed). */
let latent = { width: 64, height: 64 }
let tokenizer: ClipTokenizer | null = null
let loading: Promise<void> | null = null

function progress(detail: string, fraction: number) {
  scope.postMessage({ type: 'progress', detail, fraction })
}

async function bytes(path: string): Promise<ArrayBuffer> {
  return (await readModelFile(SD_TURBO, path)).arrayBuffer()
}

async function load(): Promise<void> {
  if (sessions) return
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu || !(await gpu.requestAdapter())) throw new Error('WebGPU is not available in this browser or on this device.')
  progress('Starting ONNX Runtime (WebGPU)', 0.02)
  ort = await import('onnxruntime-web/webgpu')
  configureOrt(ort)

  progress('Loading tokenizer', 0.05)
  const [vocab, merges] = await Promise.all([
    readModelFile(SD_TURBO, 'tokenizer/vocab.json').then((r) => r.json() as Promise<Record<string, number>>),
    readModelFile(SD_TURBO, 'tokenizer/merges.txt').then((r) => r.text()),
  ])
  tokenizer = new ClipTokenizer(vocab, merges)

  // Session options follow Microsoft's reference SD-Turbo WebGPU example.
  progress('Loading text encoder (680 MB)', 0.1)
  const text = await ort.InferenceSession.create(await bytes('text_encoder/model.onnx'), {
    ...BASE_OPTIONS,
    freeDimensionOverrides: { batch_size: 1 },
    preferredOutputLocation: { last_hidden_state: 'gpu-buffer' },
  })
  const { unet, vae } = await imageSessions(latent.width, latent.height, 0.35)
  sessions = { text, unet, vae }
  progress('Ready', 1)
}

const BASE_OPTIONS: OrtTypes.InferenceSession.SessionOptions = {
  executionProviders: ['webgpu'],
  enableMemPattern: false,
  enableCpuMemArena: false,
  extra: {
    session: {
      disable_prepacking: '1',
      use_device_allocator_for_initializers: '1',
      use_ort_model_bytes_directly: '1',
      use_ort_model_bytes_for_initializers: '1',
    },
  },
}

/** UNet + VAE decoder specialized for one latent size (pixels / 8). */
async function imageSessions(width: number, height: number, from: number): Promise<{ unet: Session; vae: Session }> {
  progress('Loading image model (1.7 GB)', from)
  const unet = await ort!.InferenceSession.create(await bytes('unet/model.onnx'), {
    ...BASE_OPTIONS,
    freeDimensionOverrides: { batch_size: 1, num_channels: 4, height, width, sequence_length: 77 },
  })
  progress('Loading image decoder (99 MB)', from + (1 - from) * 0.8)
  const vae = await ort!.InferenceSession.create(await bytes('vae_decoder/model.onnx'), {
    ...BASE_OPTIONS,
    freeDimensionOverrides: { batch_size: 1, num_channels_latent: 4, height_latent: height, width_latent: width },
  })
  return { unet, vae }
}

/** Re-specialize the image sessions when a different picture size is asked for. */
async function ensureSize(width: number, height: number): Promise<void> {
  if (!sessions || (latent.width === width && latent.height === height)) return
  const current = sessions
  await Promise.all([current.unet.release(), current.vae.release()])
  progress(`Preparing the image model for ${width * 8}×${height * 8}`, 0)
  try {
    const next = await imageSessions(width, height, 0.05)
    sessions = { ...current, ...next }
    latent = { width, height }
  } catch (error) {
    // Don't keep half-released sessions around: the next request reloads from scratch.
    await current.text.release().catch(() => {})
    sessions = null
    throw error
  }
  progress('Ready', 1)
}

/** Gaussian noise from a seeded PRNG (Box–Muller), so a seed reproduces an image. */
function noise(size: number, seed: number, scale: number): Float32Array {
  const rng = createRng(seed)
  const out = new Float32Array(size)
  for (let i = 0; i < size; i += 2) {
    const u = Math.max(1e-12, rng())
    const v = rng()
    const r = Math.sqrt(-2 * Math.log(u))
    out[i] = r * Math.cos(2 * Math.PI * v) * scale
    if (i + 1 < size) out[i + 1] = r * Math.sin(2 * Math.PI * v) * scale
  }
  return out
}

/** Picture sizes are multiples of 64 px (the UNet halves the 1/8-size latent three times). */
async function generate(prompt: string, seed: number, width = 512, height = 512): Promise<{ blob: Blob; ms: number }> {
  // Reload if a previous size change failed and dropped the sessions.
  if (!sessions) await load()
  if (!sessions || !ort || !tokenizer) throw new Error('The model is not loaded.')
  await ensureSize(Math.round(width / 64) * 8, Math.round(height / 64) * 8)
  const shape = [1, 4, latent.height, latent.width]
  const started = performance.now()
  const ids = tokenizer.inputIds(prompt)
  const { last_hidden_state: hidden } = await sessions.text.run({ input_ids: new ort.Tensor('int32', ids, [1, ids.length]) })

  const size = shape.reduce((a, b) => a * b, 1)
  const latents = noise(size, seed, SIGMA)
  const scaled = new Float32Array(size)
  const div = Math.sqrt(SIGMA * SIGMA + 1)
  for (let i = 0; i < size; i++) scaled[i] = latents[i]! / div
  const { out_sample: eps } = await sessions.unet.run({
    sample: new ort.Tensor('float32', scaled, shape),
    timestep: new ort.Tensor('int64', BigInt64Array.from([999n]), [1]),
    encoder_hidden_states: hidden!,
  })
  hidden!.dispose()

  // One Euler step to t=0 (x0 = x − σ·ε), then undo the VAE latent scaling.
  const epsData = (await eps!.getData()) as Float32Array
  const denoised = new Float32Array(size)
  for (let i = 0; i < size; i++) denoised[i] = (latents[i]! - SIGMA * epsData[i]!) / VAE_SCALING
  eps!.dispose()

  const { sample } = await sessions!.vae.run({ latent_sample: new ort.Tensor('float32', denoised, shape) })
  // NCHW float [-1, 1] → RGBA bytes.
  const [h, w] = [sample!.dims[2]!, sample!.dims[3]!]
  const pixels = (await sample!.getData()) as Float32Array
  sample!.dispose()
  const plane = w * h
  const rgba = new Uint8ClampedArray(plane * 4)
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = (pixels[c * plane + i]! / 2 + 0.5) * 255
    rgba[i * 4 + 3] = 255
  }
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return { blob, ms: performance.now() - started }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/out of memory|OOM|allocation|device lost|DeviceLost/i.test(message)) {
    return 'The GPU ran out of memory or was reset. Close other GPU-heavy tabs/apps and try again; this model needs about 4 GB of GPU memory.'
  }
  if (/shader-f16|f16/i.test(message)) return 'This GPU lacks half-precision (shader-f16) support, which this model requires.'
  return message
}

scope.onmessage = async (event: MessageEvent) => {
  const msg = event.data as { type: string; id?: number; prompt?: string; seed?: number; width?: number; height?: number }
  try {
    if (msg.type === 'load') {
      loading ??= load().finally(() => (loading = null))
      await loading
      scope.postMessage({ type: 'loaded' })
    } else if (msg.type === 'generate') {
      if (loading) await loading
      const result = await generate(msg.prompt ?? '', msg.seed ?? 1, msg.width, msg.height)
      scope.postMessage({ type: 'image', id: msg.id, ...result })
    } else if (msg.type === 'unload') {
      if (sessions) {
        await Promise.all([sessions.text.release(), sessions.unet.release(), sessions.vae.release()])
        sessions = null
      }
      scope.postMessage({ type: 'unloaded' })
    }
  } catch (error) {
    scope.postMessage({ type: 'error', id: msg.id, message: describe(error) })
  }
}
