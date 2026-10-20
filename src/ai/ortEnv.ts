import type * as OrtTypes from 'onnxruntime-web'

/**
 * Shared ONNX Runtime Web settings for LocVid's model workers: one thread
 * (the app isn't cross-origin isolated), no proxy worker, quiet logs.
 *
 * Set VITE_ORT_WASM_URL at build time to load the ~27 MB runtime binary from
 * elsewhere (for static hosts with a per-file size limit); the build then
 * leaves it out of dist/ and allows that host in the Content-Security-Policy.
 */
export function configureOrt(ort: typeof OrtTypes): void {
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  ort.env.logLevel = 'error'
  const wasm = import.meta.env.VITE_ORT_WASM_URL as string | undefined
  if (wasm) ort.env.wasm.wasmPaths = { wasm }
}
