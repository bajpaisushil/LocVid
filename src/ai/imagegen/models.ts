/**
 * Optional in-browser image generation models. Only models that genuinely
 * run in a browser tab with onnxruntime-web are listed, pinned to an exact
 * repository revision with exact file sizes (downloads are verified).
 */

export interface ModelFile {
  path: string
  bytes: number
}

export interface ImageModel {
  id: string
  name: string
  publisher: string
  description: string
  license: { name: string; url: string; summary: string; attribution?: string }
  repo: string
  revision: string
  files: ModelFile[]
  output: { width: number; height: number }
  requirements: { webgpu: true; shaderF16: boolean; gpuMemoryGB: number; ramGB: number }
  /** Rough expectations so the UI can set them honestly. */
  speed: string
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

export function modelBytes(model: ImageModel): number {
  return model.files.reduce((n, f) => n + f.bytes, 0)
}

export function fileUrl(model: ImageModel, file: ModelFile): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.path}`
}
