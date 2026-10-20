import { describe, expect, it } from 'vitest'
import { buildAudioPlan, duckWindows } from './audioPlan'
import { createAudioTrack, createProject, createScene } from './defaults'
import { buildTimeline } from './timeline'
import type { AssetMeta, Project } from './types'

function asset(id: string, kind: AssetMeta['kind'], duration: number, hasAudio = true): AssetMeta {
  return { id, kind, name: id, mimeType: '', size: 1, duration, hasAudio, fingerprint: id, origin: 'import', createdAt: 0 }
}

const assets = {
  music: asset('music', 'audio', 30),
  voice: asset('voice', 'audio', 3),
  clip: asset('clip', 'video', 4),
  silentClip: asset('silentClip', 'video', 4, false),
}

function project(): Project {
  const p = createProject()
  const a = createScene({ index: 0, duration: 5 })
  const b = createScene({ index: 1, duration: 5, asset: { id: 'clip', kind: 'video', duration: 4 } })
  b.transition = { type: 'crossfade', duration: 1 }
  a.audio = { assetId: 'voice', volume: 1, offset: 0.5 }
  p.scenes = [a, b]
  return p
}

describe('audio plan', () => {
  it('trims music to the project length and fades it out', () => {
    const p = project()
    p.audioTracks = [createAudioTrack({ id: 'music', duration: 30 }, 'music')]
    const plan = buildAudioPlan(p, assets, buildTimeline(p), { includeVideoAudio: true })
    const music = plan.find((c) => c.source === 'track')!
    expect(music.start).toBe(0)
    expect(music.duration).toBe(10)
    expect(music.fadeOut).toBe(2)
    expect(music.duck).toBe(true)
  })

  it('loops short music to fill the project when looping is on', () => {
    const p = project()
    p.audioTracks = [{ ...createAudioTrack({ id: 'voice', duration: 3 }, 'music'), loop: true }]
    const plan = buildAudioPlan(p, assets, buildTimeline(p), { includeVideoAudio: false })
    expect(plan[0]!.duration).toBe(10)
    expect(plan[0]!.loop).toBe(true)
  })

  it('starts a voice-over with its scene and cuts it at the scene end', () => {
    const p = project()
    p.scenes[0]!.audio = { assetId: 'music', volume: 1, offset: 1 }
    const plan = buildAudioPlan(p, assets, buildTimeline(p), { includeVideoAudio: false })
    const vo = plan.find((c) => c.source === 'voiceover')!
    expect(vo.start).toBe(1)
    expect(vo.duration).toBe(4)
  })

  it('plays clip audio across the scene’s visible window, fading through transitions', () => {
    const p = project()
    const plan = buildAudioPlan(p, assets, buildTimeline(p), { includeVideoAudio: true })
    const video = plan.find((c) => c.source === 'video')!
    expect(video.start).toBe(4.5)
    expect(video.offset).toBe(0)
    expect(video.duration).toBe(5.5)
    expect(video.loop).toBe(true)
    expect(video.fadeIn).toBe(1)
  })

  it('skips clips without audio or muted', () => {
    const p = project()
    const bg = p.scenes[1]!.background
    if (bg.kind === 'media') bg.assetId = 'silentClip'
    const plan = buildAudioPlan(p, assets, buildTimeline(p), { includeVideoAudio: true })
    expect(plan.some((c) => c.source === 'video')).toBe(false)
  })

  it('omits clip audio when the preview plays it through the video element', () => {
    const p = project()
    const plan = buildAudioPlan(p, assets, buildTimeline(p), { includeVideoAudio: false })
    expect(plan.some((c) => c.source === 'video')).toBe(false)
  })

  it('merges nearby narration into duck windows', () => {
    const windows = duckWindows([
      { start: 1, duration: 2, source: 'voiceover', role: 'narration' },
      { start: 3.4, duration: 1, source: 'voiceover', role: 'narration' },
      { start: 8, duration: 1, source: 'video', role: 'sfx' },
      { start: 0, duration: 10, source: 'track', role: 'music' },
    ] as never)
    expect(windows).toEqual([
      { start: 1, end: 4.4 },
      { start: 8, end: 9 },
    ])
  })
})
