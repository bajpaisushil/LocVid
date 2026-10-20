/**
 * Device capability report for optional local AI. Everything is
 * feature-detected; nothing is assumed from the user agent.
 */
export interface WebGPUInfo {
  available: boolean
  /** Why WebGPU is unavailable, when it is. */
  reason?: string
  vendor?: string
  architecture?: string
  description?: string
  shaderF16: boolean
  maxBufferSize: number
  maxStorageBufferBindingSize: number
}

export interface DeviceCapabilities {
  webgpu: WebGPUInfo
  wasmSimd: boolean
  wasmThreads: boolean
  crossOriginIsolated: boolean
  deviceMemory: number | null
  cores: number
  storageQuota: number | null
  storageUsage: number | null
}

// Minimal module using a v128 instruction: validates only if WASM SIMD is supported.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
])

interface GPUAdapterLike {
  features: { has(name: string): boolean }
  limits: { maxBufferSize: number; maxStorageBufferBindingSize: number }
  info?: { vendor?: string; architecture?: string; description?: string }
}

async function probeWebGPU(): Promise<WebGPUInfo> {
  const none = { shaderF16: false, maxBufferSize: 0, maxStorageBufferBindingSize: 0 }
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: unknown): Promise<GPUAdapterLike | null> } }).gpu
  if (!gpu) return { available: false, reason: 'This browser does not expose WebGPU.', ...none }
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return { available: false, reason: 'WebGPU is present but no GPU adapter is available (blocklisted or disabled).', ...none }
    return {
      available: true,
      vendor: adapter.info?.vendor,
      architecture: adapter.info?.architecture,
      description: adapter.info?.description,
      shaderF16: adapter.features.has('shader-f16'),
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    }
  } catch (error) {
    return { available: false, reason: `WebGPU adapter request failed: ${(error as Error).message}`, ...none }
  }
}

let cached: Promise<DeviceCapabilities> | null = null

export function detectDeviceCapabilities(): Promise<DeviceCapabilities> {
  if (!cached) {
    cached = (async () => {
      const nav = navigator as Navigator & { deviceMemory?: number }
      let quota: number | null = null
      let usage: number | null = null
      try {
        const est = await navigator.storage?.estimate?.()
        quota = est?.quota ?? null
        usage = est?.usage ?? null
      } catch {
        // unknown
      }
      let wasmSimd = false
      try {
        wasmSimd = typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE)
      } catch {
        wasmSimd = false
      }
      return {
        webgpu: await probeWebGPU(),
        wasmSimd,
        wasmThreads: typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true,
        crossOriginIsolated: globalThis.crossOriginIsolated === true,
        deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
        cores: nav.hardwareConcurrency || 2,
        storageQuota: quota,
        storageUsage: usage,
      }
    })()
  }
  return cached
}
