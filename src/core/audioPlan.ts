import { roundTo } from '@/lib/math'
import type { Timeline } from './timeline'
import type { AssetMeta, AudioRole, Project } from './types'

/**
 * The audio plan: every sound in the project as a scheduled clip on the
 * project timeline. Both the live preview (Web Audio, real time) and the
 * export (OfflineAudioContext mixdown) are driven by this one description,
 * so what you hear while editing is what gets exported.
 */

export type ClipSource = 'track' | 'voiceover' | 'video'

export interface AudioClip {
  id: string
  assetId: string
  source: ClipSource
  role: AudioRole
  /** Timeline time when the clip starts, seconds. */
  start: number
  /** Position in the source file at `start`, seconds. */
  offset: number
  /** How long it plays on the timeline, seconds. */
  duration: number
  /** Loop the source region [offset, sourceDuration) to fill `duration`. */
  loop: boolean
  volume: number
  fadeIn: number
  fadeOut: number
  /** Lowered while narration, voice-overs or clip audio play. */
  duck: boolean
}

export interface DuckWindow {
  start: number
  end: number
}

/** Music level while ducked, relative to its normal volume. */
export const DUCK_LEVEL = 0.3
export const DUCK_RAMP = 0.35
/** Minimum fade applied at clip edges to avoid clicks. */
const EDGE_FADE = 0.01

export function buildAudioPlan(
  project: Pick<Project, 'scenes' | 'audioTracks'>,
  assets: Record<string, AssetMeta | undefined>,
  timeline: Timeline,
  options: { includeVideoAudio: boolean },
): AudioClip[] {
  const end = timeline.duration
  const clips: AudioClip[] = []
  if (end <= 0) return clips

  for (const track of project.audioTracks) {
    const asset = assets[track.assetId]
    if (!asset?.duration || track.volume <= 0 || track.start >= end) continue
    const available = Math.max(0, asset.duration - track.trimStart)
    if (available <= 0.01) continue
    const wanted = track.duration ?? (track.loop ? Infinity : available)
    const duration = Math.min(wanted, track.loop ? Infinity : available, end - track.start)
    if (duration <= 0.01) continue
    clips.push({
      id: `track:${track.id}`,
      assetId: track.assetId,
      source: 'track',
      role: track.role,
      start: track.start,
      offset: track.trimStart,
      duration: roundTo(duration, 4),
      loop: track.loop && duration > available,
      volume: track.volume,
      fadeIn: Math.max(EDGE_FADE, Math.min(track.fadeIn, duration / 2)),
      fadeOut: Math.max(EDGE_FADE, Math.min(track.fadeOut, duration / 2)),
      duck: track.duck && track.role === 'music',
    })
  }

  for (const entry of timeline.entries) {
    const { scene } = entry
    if (scene.audio) {
      const asset = assets[scene.audio.assetId]
      const start = entry.start + scene.audio.offset
      const duration = Math.min(asset?.duration ?? 0, entry.end - start)
      if (asset && scene.audio.volume > 0 && duration > 0.01) {
        clips.push({
          id: `vo:${scene.id}`,
          assetId: asset.id,
          source: 'voiceover',
          role: 'narration',
          start,
          offset: 0,
          duration: roundTo(duration, 4),
          loop: false,
          volume: scene.audio.volume,
          fadeIn: EDGE_FADE,
          fadeOut: Math.min(0.05, duration / 2),
          duck: false,
        })
      }
    }
    const bg = scene.background
    if (options.includeVideoAudio && bg.kind === 'media' && bg.volume > 0) {
      const asset = assets[bg.assetId]
      if (asset?.kind === 'video' && asset.hasAudio !== false && asset.duration) {
        const start = Math.max(0, entry.visibleStart)
        const visible = Math.min(end, entry.visibleEnd) - start
        const available = Math.max(0, asset.duration - bg.trimStart)
        const duration = bg.loop ? visible : Math.min(visible, available)
        if (duration > 0.01 && available > 0.01) {
          clips.push({
            id: `video:${scene.id}`,
            assetId: asset.id,
            source: 'video',
            role: 'sfx',
            start,
            offset: bg.trimStart + (start - entry.visibleStart),
            duration: roundTo(duration, 4),
            loop: bg.loop && visible > available,
            volume: bg.volume,
            fadeIn: Math.max(EDGE_FADE, entry.inDuration),
            fadeOut: Math.max(EDGE_FADE, entry.outDuration),
            duck: false,
          })
        }
      }
    }
  }
  return clips
}

/** Merged time ranges during which ducked music should be lowered. */
export function duckWindows(clips: readonly AudioClip[]): DuckWindow[] {
  const triggers = clips
    .filter((c) => c.role === 'narration' || c.source === 'voiceover' || c.source === 'video')
    .map((c) => ({ start: c.start, end: c.start + c.duration }))
    .toSorted((a, b) => a.start - b.start)
  const merged: DuckWindow[] = []
  for (const w of triggers) {
    const last = merged[merged.length - 1]
    // Bridge short gaps so music doesn't pump up and down between sentences.
    if (last && w.start <= last.end + DUCK_RAMP * 2) last.end = Math.max(last.end, w.end)
    else merged.push({ ...w })
  }
  return merged
}

/** Assets the plan needs decoded audio for. */
export function planAssetIds(clips: readonly AudioClip[]): string[] {
  return [...new Set(clips.map((c) => c.assetId))]
}
