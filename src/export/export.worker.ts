import { runWebCodecsPipeline } from './webcodecsPipeline'
import { toExportError, type RenderJob } from './types'

/**
 * Background export worker: renders and encodes frames off the main thread
 * so the editor stays responsive. Messages:
 *   in:  { type: 'probe' } | { type: 'start', job } | { type: 'cancel' }
 *   out: { type: 'probe-result', ... } | { type: 'progress', frame, total } |
 *        { type: 'done', buffer, warnings, videoCodec, audioCodec } | { type: 'error', code, message, suggestion }
 */

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent) => void) | null
  fonts?: FontFaceSet
}
const scope = self as unknown as WorkerScope

let cancelled = false

async function probe() {
  let canvas2d = false
  try {
    canvas2d = typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(2, 2).getContext('2d')
  } catch {
    canvas2d = false
  }
  const fonts = typeof FontFace !== 'undefined' && !!scope.fonts
  const videoEncoder = typeof VideoEncoder !== 'undefined'
  const videoDecoder = typeof VideoDecoder !== 'undefined'
  let webgl2 = false
  try {
    webgl2 = typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(2, 2).getContext('webgl2')
  } catch {
    webgl2 = false
  }
  return { type: 'probe-result', canvas2d, fonts, videoEncoder, videoDecoder, webgl2 }
}

scope.onmessage = async (event: MessageEvent) => {
  const msg = event.data as { type: string; job?: RenderJob }
  if (msg.type === 'probe') {
    scope.postMessage(await probe())
    return
  }
  if (msg.type === 'cancel') {
    cancelled = true
    return
  }
  if (msg.type === 'start' && msg.job) {
    cancelled = false
    try {
      const result = await runWebCodecsPipeline(
        msg.job,
        {
          createCanvas: (w, h) => new OffscreenCanvas(w, h),
          fontScope: scope,
          allowElementFallback: false,
        },
        {
          onProgress: (frame, total) => scope.postMessage({ type: 'progress', frame, total }),
          isCancelled: () => cancelled,
        },
      )
      scope.postMessage(
        { type: 'done', buffer: result.buffer, warnings: result.warnings, videoCodec: result.videoCodec, audioCodec: result.audioCodec },
        [result.buffer],
      )
    } catch (error) {
      const e = toExportError(error)
      scope.postMessage({ type: 'error', code: e.code, message: e.message, suggestion: e.suggestion })
    }
  }
}
