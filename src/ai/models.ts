/**
 * Optional on-device AI models. Only models that genuinely run in a browser
 * tab with ONNX Runtime Web are listed, each pinned to an exact repository
 * revision with exact file sizes (downloads are verified byte for byte).
 */

export interface ModelFile {
  path: string
  bytes: number
}

export interface ModelManifest {
  id: string
  name: string
  publisher: string
  description: string
  license: { name: string; url: string; summary: string; attribution?: string }
  repo: string
  revision: string
  files: ModelFile[]
  /** Rough expectations so the UI can set them honestly. */
  speed: string
}

export interface ImageModel extends ModelManifest {
  output: { width: number; height: number }
  requirements: { webgpu: true; shaderF16: boolean; gpuMemoryGB: number; ramGB: number }
}

export const SD_TURBO: ImageModel = {
  id: 'sd-turbo',
  name: 'SD-Turbo',
  publisher: 'Stability AI (ONNX conversion for ONNX Runtime Web by schmuell)',
  description: 'A distilled Stable Diffusion 2.1 that produces a 512×512 image from a text prompt in a single step.',
  license: {
    name: 'Stability AI Community License',
    url: 'https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md',
    summary:
      'Free for research, personal and non-commercial use, and for commercial use by individuals or organizations with under US$1M annual revenue (commercial users must register with Stability AI). Outputs are yours to the extent the law allows.',
    attribution: 'Powered by Stability AI',
  },
  repo: 'schmuell/sd-turbo-ort-web',
  revision: 'ace89b7d2cd849f9a73914cdbb8a3ea60c853dd1',
  files: [
    { path: 'tokenizer/vocab.json', bytes: 1_059_962 },
    { path: 'tokenizer/merges.txt', bytes: 524_619 },
    { path: 'text_encoder/model.onnx', bytes: 681_393_168 },
    { path: 'unet/model.onnx', bytes: 1_733_430_199 },
    { path: 'vae_decoder/model.onnx', bytes: 99_094_314 },
  ],
  output: { width: 512, height: 512 },
  requirements: { webgpu: true, shaderF16: true, gpuMemoryGB: 4, ramGB: 8 },
  speed: 'First image after loading takes ~10–60 s (GPU shader compilation); later images take seconds on a recent laptop GPU.',
}

export function modelBytes(model: ModelManifest): number {
  return model.files.reduce((n, f) => n + f.bytes, 0)
}

export function fileUrl(model: ModelManifest, file: ModelFile): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.path}`
}

const DEPTH_LICENSE = {
  name: 'Apache-2.0',
  url: 'https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf',
  summary: 'Permissive: free for personal and commercial use.',
}

/** Depth Anything V2 Small, fp16 — for GPUs with WebGPU half precision. */
export const DEPTH_GPU: ModelManifest = {
  id: 'depth-anything-v2-small-fp16',
  name: 'Depth Anything V2 Small',
  publisher: 'Depth Anything team (ONNX by onnx-community)',
  description: 'Estimates how far away every pixel of a photo is, so the camera can move through it in 3D.',
  license: DEPTH_LICENSE,
  repo: 'onnx-community/depth-anything-v2-small',
  revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d',
  files: [{ path: 'onnx/model_fp16.onnx', bytes: 49_642_442 }],
  speed: 'Well under a second per image on a recent GPU.',
}

/** Same model, int8 — runs on any CPU through WebAssembly (no WebGPU needed). */
export const DEPTH_CPU: ModelManifest = {
  ...DEPTH_GPU,
  id: 'depth-anything-v2-small-int8',
  files: [{ path: 'onnx/model_quantized.onnx', bytes: 27_258_801 }],
  speed: 'A few seconds per image on the CPU.',
}
