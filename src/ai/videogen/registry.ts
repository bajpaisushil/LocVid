/**
 * Adapter point for on-device text/image-to-video models. No open video model
 * runs reliably in a browser tab today (see the README's research notes), so
 * nothing is registered by default and no control appears. A future model
 * (e.g. an ONNX Runtime Web or WebGPU port) implements this interface, calls
 * `registerVideoGenerator`, and "Describe your video" offers it as a source:
 * each shot's clip is imported into the media bin like any other video.
 */

export interface VideoGenerationRequest {
  prompt: string
  /** Optional first frame (image-to-video). */
  image?: Blob
  seconds: number
  width: number
  height: number
  fps: number
  seed: number
}

export type VideoGeneratorStatus = { state: 'ready' } | { state: 'needs-download'; bytes: number } | { state: 'unsupported'; reason: string }

export interface VideoGenerator {
  id: string
  label: string
  /** License name and URL shown before download/use. */
  license: { name: string; url: string }
  status(): Promise<VideoGeneratorStatus>
  /** Returns an encoded clip (MP4 or WebM) the editor can import. */
  generate(request: VideoGenerationRequest, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Blob>
}

const registry = new Map<string, VideoGenerator>()

export function registerVideoGenerator(generator: VideoGenerator): void {
  registry.set(generator.id, generator)
}

export function listVideoGenerators(): VideoGenerator[] {
  return [...registry.values()]
}

/** The first registered generator that is ready to run on this device, if any. */
export async function readyVideoGenerator(): Promise<VideoGenerator | null> {
  for (const g of registry.values()) {
    try {
      if ((await g.status()).state === 'ready') return g
    } catch {
      // A broken adapter must not break the dialog.
    }
  }
  return null
}
