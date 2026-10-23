import { createAudioTrack, createOverlay, createScene } from '@/core/defaults'
import { applyStoryboard } from '@/core/operations'
import type { AssetMeta, Scene } from '@/core/types'
import { useEditorStore } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'
import { planWorld, type WorldPlan } from '@/world/director'

export interface WorldVideoOptions {
  /** Target length in seconds. */
  length: number
  mode: 'replace' | 'append'
  /** On-screen captions (off by default: the picture tells the story). */
  captions?: boolean
  music?: AssetMeta
  /** Start playing as soon as the shots are on the timeline. */
  autoplay?: boolean
  seed?: number
}

/**
 * "Describe your video" as live 3D: plans the world and its shots from the
 * prompt, puts them on the timeline (every shot films the same continuous
 * story) and starts playing. Instant — nothing to download or generate.
 */
export function createWorldVideo(prompt: string, options: WorldVideoOptions): WorldPlan {
  const { project, apply } = useEditorStore.getState()
  if (!project) throw new Error('No project is open.')
  const plan = planWorld(prompt, options.length, options.seed)
  const first = options.mode === 'append' ? project.scenes.length : 0
  const scenes: Scene[] = plan.shots.map((shot, i) => {
    const scene = createScene({ index: first + i, title: shot.title, duration: shot.duration })
    scene.background = { kind: 'world', world: plan.world, shot: shot.shot, start: shot.start }
    scene.motion = { ...scene.motion, preset: 'none' }
    scene.look = { ...plan.look }
    scene.transition = { type: first > 0 && i === 0 ? 'crossfade' : shot.transition, duration: 0.4 }
    if (options.captions) {
      const text = i === 0 ? plan.title : shot.title
      scene.overlays.push({ ...createOverlay(text, i === 0 ? 'title' : 'caption', project.aspectRatio), start: i === 0 ? 0.3 : 0.4 })
    }
    return scene
  })
  const offset = options.mode === 'append' ? project.scenes.reduce((t, s) => t + s.duration, 0) : 0
  apply(
    (d) => {
      applyStoryboard(d, scenes, options.mode)
      if (options.mode === 'replace' && d.name === 'Untitled project') d.name = plan.title
      if (options.music) d.audioTracks.push(createAudioTrack(options.music, 'music', offset))
    },
    { select: { kind: 'scene', sceneId: scenes[0]!.id } },
  )
  const playback = usePlaybackStore.getState()
  playback.seek(offset)
  if (options.autoplay) playback.play()
  return plan
}
