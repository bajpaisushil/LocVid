import { outputDimensions } from '@/core/defaults'
import { buildTimeline, frameCount } from '@/core/timeline'
import { MAX_PROJECT_DURATION, type AssetMeta, type Project } from '@/core/types'
import { safeFileName } from '@/lib/download'
import { analyzeCutout, analyzeDepth, areCutoutModelsReady, hasCutout, isDepthModelReady } from '@/ai/vision/depth'
import { lookIsNeutral } from '@/core/defaults'
import type { DepthAnalysis } from '@/storage/db'
import { getAnalyses, getAssetBlob, getAssets } from '@/storage/repo'
import { mixProjectAudio } from './audioMix'
import { detectExportCapabilities, type ExportCapabilities } from './capabilities'
import { muxAacWithFFmpeg, runFFmpegPipeline } from './ffmpegPipeline'
import { terminateFFmpeg } from './ffmpeg'
import { ExportError, toExportError, type EnginePreference, type ExportEngine, type ExportProgress, type ExportResult, type ExportSettings, type ExportStage, type RenderJob } from './types'
import { runWebCodecsPipeline } from './webcodecsPipeline'
import { createExportWorker } from './worker'

export const BITRATES = {
  '720p': { video: 5_000_000, audio: 160_000 },
  '1080p': { video: 9_000_000, audio: 192_000 },
} as const

export function exportSettingsFor(project: Project, engine: EnginePreference): ExportSettings {
  const { width, height } = outputDimensions(project.aspectRatio, project.output.resolution)
  const rates = BITRATES[project.output.resolution]
  return { width, height, fps: project.output.fps, videoBitrate: rates.video, audioBitrate: rates.audio, engine }
}

/** Assets the export actually draws or plays (not merely sitting in the media bin). */
export function usedAssetIds(project: Project): string[] {
  const ids = new Set<string>()
  for (const scene of project.scenes) {
    if (scene.background.kind === 'media') ids.add(scene.background.assetId)
    if (scene.audio) ids.add(scene.audio.assetId)
  }
  for (const track of project.audioTracks) ids.add(track.assetId)
  if (project.brand.logoAssetId) ids.add(project.brand.logoAssetId)
  return [...ids]
}

/** Image assets used by scenes with cinematic 3D motion enabled. */
export function cinematicAssetIds(project: Project, metas: Record<string, AssetMeta>): string[] {
  const ids = new Set<string>()
  for (const s of project.scenes) {
    if (s.cinematic.enabled && s.background.kind === 'media' && metas[s.background.assetId]?.kind === 'image') ids.add(s.background.assetId)
  }
  return [...ids]
}

/** Pictures whose cinematic scenes animate the subject (or play football with it): they need a cut-out. */
export function actingAssetIds(project: Project): string[] {
  const ids = new Set<string>()
  for (const s of project.scenes) {
    if (!s.cinematic.enabled || s.background.kind !== 'media') continue
    if (s.cinematic.subject.action !== 'none' || s.cinematic.props.includes('football')) ids.add(s.background.assetId)
  }
  return [...ids]
}

export interface Preflight {
  duration: number
  frames: number
  problems: { code: 'empty' | 'too-long' | 'missing-media'; message: string }[]
  warnings: string[]
  estimatedBytes: number
}

/** Checks before starting: length limits, missing media, rough output size. */
export async function preflight(project: Project, settings: ExportSettings): Promise<Preflight> {
  const timeline = buildTimeline(project)
  const problems: Preflight['problems'] = []
  const warnings: string[] = []
  if (project.scenes.length === 0 || timeline.duration <= 0) problems.push({ code: 'empty', message: 'Add at least one scene to export.' })
  if (timeline.duration > MAX_PROJECT_DURATION) {
    problems.push({
      code: 'too-long',
      message: `The video is ${Math.ceil(timeline.duration)} s long; the limit is ${MAX_PROJECT_DURATION / 60} minutes.`,
    })
  }
  const ids = usedAssetIds(project)
  const found = new Map((await getAssets(ids)).map((a) => [a.meta.id, a.meta]))
  const missingScenes = project.scenes
    .map((s, i) => (s.background.kind === 'media' && !found.has(s.background.assetId) ? i + 1 : null))
    .filter((n): n is number => n !== null)
  if (missingScenes.length) {
    problems.push({
      code: 'missing-media',
      message: `Scene${missingScenes.length > 1 ? 's' : ''} ${missingScenes.join(', ')} use${missingScenes.length > 1 ? '' : 's'} media that is missing from this browser. Re-import it and choose it in the scene's Background section.`,
    })
  }
  const missingAudio = [...project.audioTracks.map((t) => t.assetId), ...project.scenes.flatMap((s) => (s.audio ? [s.audio.assetId] : []))].filter(
    (id) => !found.has(id),
  )
  if (missingAudio.length) warnings.push(`${missingAudio.length} audio clip${missingAudio.length > 1 ? 's are' : ' is'} missing and will be silent.`)
  if (project.brand.logoAssetId && !found.has(project.brand.logoAssetId)) warnings.push('The logo image is missing and will be skipped.')
  const estimatedBytes = Math.round(((settings.videoBitrate + settings.audioBitrate) / 8) * timeline.duration)
  return { duration: timeline.duration, frames: frameCount(timeline.duration, settings.fps), problems, warnings, estimatedBytes }
}

export interface ExportCallbacks {
  onProgress(progress: ExportProgress): void
}

/** Relative cost of each stage, so the overall bar moves in proportion to real work. */
const STAGE_WEIGHTS: Record<ExportStage, [number, number]> = {
  preparing: [0, 0.02],
  'loading-ffmpeg': [0.02, 0.06],
  audio: [0.06, 0.1],
  video: [0.1, 0.95],
  finalizing: [0.95, 1],
}

function overall(stage: ExportStage, fraction: number): number {
  const [a, b] = STAGE_WEIGHTS[stage]
  return a + (b - a) * Math.max(0, Math.min(1, fraction))
}

/** Export the project to an MP4 Blob. Rejects with ExportError (code 'cancelled' on abort). */
export async function exportProject(project: Project, preference: EnginePreference, callbacks: ExportCallbacks, signal: AbortSignal): Promise<ExportResult> {
  const startedAt = performance.now()
  const settings = exportSettingsFor(project, preference)
  const report = (stage: ExportStage, fraction: number, extra: Partial<ExportProgress> = {}) =>
    callbacks.onProgress({ stage, progress: overall(stage, fraction), ...extra })
  const assertActive = () => {
    if (signal.aborted) throw new ExportError('cancelled', 'Export cancelled.')
  }

  try {
    report('preparing', 0, { detail: 'Checking media' })
    const check = await preflight(project, settings)
    const problem = check.problems[0]
    if (problem) throw new ExportError(problem.code, check.problems.map((p) => p.message).join(' '))
    const warnings = [...check.warnings]

    const caps: ExportCapabilities = await detectExportCapabilities(settings.width, settings.height, settings.fps, settings.videoBitrate)
    let engine: ExportEngine = preference === 'auto' ? (caps.h264 ? 'webcodecs' : 'ffmpeg') : preference
    if (engine === 'webcodecs' && !caps.h264) {
      throw new ExportError(
        'unsupported',
        `This browser cannot encode H.264 at ${settings.width}×${settings.height} with WebCodecs.`,
        'Choose the “Compatibility (FFmpeg)” engine, or try 720p.',
      )
    }
    if (engine === 'ffmpeg' && !caps.webAssembly) {
      throw new ExportError('unsupported', 'This browser does not support WebAssembly, which the compatibility engine needs.')
    }

    // Gather metadata and blobs (Blob objects are file handles; nothing is copied yet).
    const ids = usedAssetIds(project)
    const metas: Record<string, AssetMeta> = {}
    for (const a of await getAssets(ids)) metas[a.meta.id] = a.meta
    const blobs: Record<string, Blob> = {}
    for (const id of Object.keys(metas)) blobs[id] = await getAssetBlob(id)
    assertActive()

    // Depth maps for cinematic (3D motion) scenes; analyze any missing ones if the model is here.
    const depths: Record<string, DepthAnalysis> = {}
    const needsDepth = cinematicAssetIds(project, metas)
    if (needsDepth.length) {
      const found = await getAnalyses(needsDepth)
      const missing = needsDepth.filter((id) => !found.has(id))
      if (missing.length && (await isDepthModelReady())) {
        for (let i = 0; i < missing.length; i++) {
          report('preparing', i / missing.length, { detail: `Analyzing depth ${i + 1} of ${missing.length}` })
          const record = await analyzeDepth(missing[i]!)
          found.set(record.assetId, record)
          assertActive()
        }
      }
      for (const [id, record] of found) depths[id] = record
      const without = needsDepth.filter((id) => !depths[id]).length
      if (without) warnings.push(`${without} cinematic scene image${without === 1 ? ' has' : 's have'} no depth map, so 2D motion was used instead. Download the depth model in the scene's Motion settings.`)
      // Subject animation needs the picture's cut-out; make it now if the models are here.
      const needsCutout = actingAssetIds(project).filter((id) => depths[id] && !hasCutout(depths[id]))
      if (needsCutout.length && (await areCutoutModelsReady())) {
        for (let i = 0; i < needsCutout.length; i++) {
          report('preparing', i / needsCutout.length, { detail: `Cutting out subject ${i + 1} of ${needsCutout.length}` })
          depths[needsCutout[i]!] = await analyzeCutout(needsCutout[i]!)
          assertActive()
        }
      }
      const still = actingAssetIds(project).filter((id) => depths[id] && !hasCutout(depths[id])).length
      if (still) warnings.push(`${still} scene picture${still === 1 ? ' was' : 's were'} not cut out, so the subject stayed still. Download the cut-out models in the scene's Motion settings.`)
    }
    const usesGL = needsDepth.length > 0 || project.scenes.some((s) => !lookIsNeutral(s.look))

    report('audio', 0, { detail: 'Mixing audio' })
    const timeline = buildTimeline(project)
    const total = frameCount(timeline.duration, settings.fps)
    const duration = total / settings.fps
    const mix = await mixProjectAudio(project, metas, blobs, timeline, duration, signal, (f, detail) => report('audio', f, { detail }))
    if (mix) warnings.push(...mix.warnings)
    assertActive()

    const job: RenderJob = {
      project,
      assets: metas,
      blobs,
      depths,
      settings,
      audio: mix && mix.channels.length ? { channels: mix.channels, sampleRate: mix.sampleRate } : null,
      encodeAudio: engine === 'webcodecs' && caps.aac,
    }

    let blob: Blob
    let renderedIn: ExportResult['renderedIn'] = 'main-thread'
    let videoCodec = 'avc1 (H.264)'
    let audioCodec: string | null = 'mp4a.40.2 (AAC-LC)'
    const t0 = performance.now()
    const onFrames = (frame: number, totalFrames: number) => {
      const elapsed = (performance.now() - t0) / 1000
      const rate = frame / Math.max(0.001, elapsed)
      report('video', frame / totalFrames, {
        frame,
        totalFrames,
        eta: rate > 0 ? (totalFrames - frame) / rate : undefined,
        speed: rate / settings.fps,
        detail: `Rendering frame ${frame} of ${totalFrames}`,
      })
    }

    if (engine === 'webcodecs') {
      report('video', 0, { frame: 0, totalFrames: total, detail: 'Starting encoder' })
      let result: { buffer: ArrayBuffer; warnings: string[]; videoCodec: string; audioCodec: string | null }
      if (caps.workerRendering && (!usesGL || caps.workerWebGL)) {
        renderedIn = 'worker'
        result = await runInWorker(job, onFrames, signal)
      } else {
        result = await runWebCodecsPipeline(
          job,
          { createCanvas: mainCanvas, fontScope: globalThis, allowElementFallback: true },
          { onProgress: onFrames, isCancelled: () => signal.aborted },
        )
      }
      warnings.push(...result.warnings)
      videoCodec = `${result.videoCodec} (H.264)`
      blob = new Blob([result.buffer], { type: 'video/mp4' })
      if (!job.encodeAudio) {
        // No AAC encoder in this browser: add the audio track with FFmpeg (video is copied as-is).
        warnings.push('This browser has no built-in AAC encoder, so the audio track was encoded with FFmpeg.wasm.')
        blob = await muxAacWithFFmpeg(blob, job, duration, (stage, f) => report(stage, f))
      } else {
        audioCodec = `${result.audioCodec ?? 'mp4a.40.2'} (AAC)`
      }
    } else {
      const result = await runFFmpegPipeline(job, {
        onProgress: (stage, fraction, frame, totalFrames) =>
          stage === 'video' && frame !== undefined && totalFrames !== undefined ? onFrames(frame, totalFrames) : report(stage, fraction),
        isCancelled: () => signal.aborted,
      })
      warnings.push(...result.warnings)
      blob = result.blob
      videoCodec = 'H.264 (libx264)'
      audioCodec = 'AAC (FFmpeg)'
    }
    assertActive()

    report('finalizing', 0.9, { detail: 'Verifying the file' })
    const verified = await verifyMp4(blob)
    report('finalizing', 1)
    return {
      blob,
      fileName: `${safeFileName(project.name, 'video')}.mp4`,
      engine,
      renderedIn: engine === 'ffmpeg' ? 'main-thread' : renderedIn,
      videoCodec,
      audioCodec: verified.hasAudio ? audioCodec : null,
      width: settings.width,
      height: settings.height,
      duration: verified.duration,
      elapsedMs: performance.now() - startedAt,
      warnings,
    }
  } catch (error) {
    if (signal.aborted) {
      terminateFFmpeg()
      throw new ExportError('cancelled', 'Export cancelled.')
    }
    throw toExportError(error)
  }
}

function mainCanvas(width: number, height: number) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

function runInWorker(
  job: RenderJob,
  onFrames: (frame: number, total: number) => void,
  signal: AbortSignal,
): Promise<{ buffer: ArrayBuffer; warnings: string[]; videoCodec: string; audioCodec: string | null }> {
  return new Promise((resolve, reject) => {
    const worker = createExportWorker()
    const finish = () => {
      signal.removeEventListener('abort', onAbort)
      worker.terminate()
    }
    const onAbort = () => {
      worker.postMessage({ type: 'cancel' })
      // Give the worker a moment to stop cleanly, then force it.
      setTimeout(() => {
        finish()
        reject(new ExportError('cancelled', 'Export cancelled.'))
      }, 300)
    }
    signal.addEventListener('abort', onAbort)
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: 'progress'; frame: number; total: number }
        | { type: 'done'; buffer: ArrayBuffer; warnings: string[]; videoCodec: string; audioCodec: string | null }
        | { type: 'error'; code: ExportError['code']; message: string; suggestion?: string }
      if (msg.type === 'progress') onFrames(msg.frame, msg.total)
      else if (msg.type === 'done') {
        finish()
        resolve(msg)
      } else if (msg.type === 'error') {
        finish()
        reject(new ExportError(msg.code, msg.message, msg.suggestion))
      }
    }
    worker.onerror = (e) => {
      finish()
      reject(new ExportError('unknown', `The export worker crashed${e.message ? `: ${e.message}` : ''}.`, 'Try again; if it keeps failing, use the compatibility engine.'))
    }
    // Audio is only needed in the worker when it encodes AAC itself; then the
    // channel buffers are transferred (moved), not copied. Otherwise keep them
    // here for the FFmpeg mux step.
    const workerJob: RenderJob = job.encodeAudio ? job : { ...job, audio: null }
    const transfer = workerJob.audio ? workerJob.audio.channels.map((c) => c.buffer as ArrayBuffer) : []
    worker.postMessage({ type: 'start', job: workerJob }, transfer)
  })
}

/** Re-open the finished file with a demuxer: never report success for a file we can't read back. */
async function verifyMp4(blob: Blob): Promise<{ duration: number; hasAudio: boolean }> {
  const { Input, BlobSource, MP4, QTFF } = await import('mediabunny')
  const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF] })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new ExportError('codec', 'The exported file has no video track.')
    const audio = await input.getPrimaryAudioTrack()
    const duration = await input.computeDuration()
    if (!(duration > 0)) throw new ExportError('codec', 'The exported file has no playable frames.')
    return { duration, hasAudio: audio !== null }
  } catch (error) {
    if (error instanceof ExportError) throw error
    throw new ExportError('codec', 'The exported file could not be read back, so it may be corrupt.', 'Try again or switch export engine.', { cause: error })
  } finally {
    input.dispose()
  }
}
