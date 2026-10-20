import type { AssetMeta, Project } from '@/core/types'

export type ExportEngine = 'webcodecs' | 'ffmpeg'
export type EnginePreference = 'auto' | ExportEngine

export interface ExportSettings {
  width: number
  height: number
  fps: number
  videoBitrate: number
  audioBitrate: number
  engine: EnginePreference
}

export type ExportStage = 'preparing' | 'loading-ffmpeg' | 'audio' | 'video' | 'finalizing'

export interface ExportProgress {
  stage: ExportStage
  /** 0..1 overall. */
  progress: number
  frame?: number
  totalFrames?: number
  /** Seconds remaining, estimated from the measured frame rate. */
  eta?: number
  /** Rendering speed relative to real time (2 = twice as fast as playback). */
  speed?: number
  detail?: string
}

export interface ExportResult {
  blob: Blob
  fileName: string
  engine: ExportEngine
  /** Where frames were rendered: a background worker or the page itself. */
  renderedIn: 'worker' | 'main-thread'
  videoCodec: string
  audioCodec: string | null
  width: number
  height: number
  duration: number
  elapsedMs: number
  warnings: string[]
}

export type ExportErrorCode =
  | 'cancelled'
  | 'empty'
  | 'too-long'
  | 'missing-media'
  | 'unsupported'
  | 'codec'
  | 'memory'
  | 'decode'
  | 'ffmpeg'
  | 'unknown'

/** An export failure with a message written for the user and a suggested next step. */
export class ExportError extends Error {
  readonly code: ExportErrorCode
  readonly suggestion?: string
  constructor(code: ExportErrorCode, message: string, suggestion?: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExportError'
    this.code = code
    this.suggestion = suggestion
  }
}

/** Everything a render job needs; blobs are passed by reference (no copy) to workers. */
export interface RenderJob {
  project: Project
  assets: Record<string, AssetMeta>
  blobs: Record<string, Blob>
  settings: ExportSettings
  /** Final mixed audio (planar), or null for a silent track. */
  audio: { channels: Float32Array[]; sampleRate: number } | null
  /** Encode AAC inside the WebCodecs pipeline (false → video-only, muxed later by FFmpeg). */
  encodeAudio: boolean
}

/** Map low-level failures (out of memory, codec errors) to actionable messages. */
export function toExportError(error: unknown): ExportError {
  if (error instanceof ExportError) return error
  const message = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''
  if (name === 'AbortError' || /abort|cancel/i.test(message)) return new ExportError('cancelled', 'Export cancelled.')
  if (name === 'QuotaExceededError' || /out of memory|allocation failed|array buffer allocation|RangeError: (Array buffer|Invalid typed array length)/i.test(`${name}: ${message}`)) {
    return new ExportError(
      'memory',
      'The browser ran out of memory while exporting.',
      'Try 720p, close other tabs, shorten the video, or use fewer/lower-resolution clips.',
      { cause: error },
    )
  }
  if (/encoder|codec|EncodingError|NotSupportedError/i.test(`${name} ${message}`)) {
    return new ExportError(
      'codec',
      `The video encoder failed: ${message}`,
      'Try the “Compatibility (FFmpeg)” engine, or 720p.',
      { cause: error },
    )
  }
  return new ExportError('unknown', `Export failed: ${message}`, 'Try again, or switch export engine.', { cause: error })
}
