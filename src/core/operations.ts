import { current, isDraft } from 'immer'
import { createId, hashString } from '@/lib/id'
import { clamp, roundTo } from '@/lib/math'
import {
  createAudioTrack,
  createGeneratedBackground,
  createMediaBackground,
  defaultMotion,
  defaultTransition,
  paletteFor,
} from './defaults'
import {
  MAX_SCENE_DURATION,
  MIN_SCENE_DURATION,
  type AssetMeta,
  type AspectRatio,
  type AudioRole,
  type AudioTrack,
  type Project,
  type Scene,
  type TextOverlay,
} from './types'

/**
 * Editing operations. Each mutates a draft project in place and is meant to
 * run inside an immer `produce` (see the editor store), which turns them into
 * immutable updates with structural sharing — cheap undo snapshots.
 */

export function findScene(project: Project, sceneId: string): Scene | undefined {
  return project.scenes.find((s) => s.id === sceneId)
}

export function addScenes(project: Project, scenes: Scene[], atIndex = project.scenes.length): void {
  const index = clamp(atIndex, 0, project.scenes.length)
  project.scenes.splice(index, 0, ...scenes)
  for (const scene of scenes) {
    if (scene.background.kind === 'media') addAssetIds(project, [scene.background.assetId])
  }
  normalizeFirstTransition(project)
}

export function removeScene(project: Project, sceneId: string): void {
  project.scenes = project.scenes.filter((s) => s.id !== sceneId)
  normalizeFirstTransition(project)
}

/** Copy a scene (with fresh IDs) right after the original. Returns the new scene ID. */
export function duplicateScene(project: Project, sceneId: string): string | null {
  const index = project.scenes.findIndex((s) => s.id === sceneId)
  if (index < 0) return null
  const original = project.scenes[index]!
  const copy: Scene = structuredClone(isDraft(original) ? current(original) : original)
  copy.id = createId('scn')
  copy.title = original.title ? `${original.title} (copy)` : 'Scene copy'
  copy.overlays = copy.overlays.map((o) => ({ ...o, id: createId('txt') }))
  if (copy.transition.type === 'none') copy.transition = defaultTransition(false)
  project.scenes.splice(index + 1, 0, copy)
  return copy.id
}

export function moveScene(project: Project, fromIndex: number, toIndex: number): void {
  const n = project.scenes.length
  if (fromIndex < 0 || fromIndex >= n) return
  const target = clamp(toIndex, 0, n - 1)
  if (target === fromIndex) return
  const [scene] = project.scenes.splice(fromIndex, 1)
  project.scenes.splice(target, 0, scene!)
  normalizeFirstTransition(project)
}

/**
 * The first scene's transition means "fade in from black". When scenes are
 * reordered, a crossfade that ends up first becomes a fade-in, and a former
 * first scene gets a regular crossfade so the cut isn't abrupt.
 */
function normalizeFirstTransition(project: Project): void {
  project.scenes.forEach((scene, i) => {
    if (i === 0 && !['none', 'fadeBlack', 'fadeWhite'].includes(scene.transition.type)) {
      scene.transition = { ...scene.transition, type: 'fadeBlack' }
    }
  })
}

export function setSceneDuration(scene: Scene, duration: number): void {
  scene.duration = roundTo(clamp(duration, MIN_SCENE_DURATION, MAX_SCENE_DURATION), 2)
}

/** Use an asset as a scene's background, keeping fit/crop settings when replacing media. */
export function setSceneMedia(project: Project, sceneId: string, asset: Pick<AssetMeta, 'id' | 'kind' | 'duration'>): void {
  const scene = findScene(project, sceneId)
  if (!scene || asset.kind === 'audio') return
  const previous = scene.background
  const next = createMediaBackground(asset)
  if (previous.kind === 'media') {
    next.fit = previous.fit
    next.fill = previous.fill
    next.fillColor = previous.fillColor
  }
  scene.background = next
  if (previous.kind !== 'media' || scene.motion.preset === 'none') {
    scene.motion = defaultMotion(asset.kind)
  }
  addAssetIds(project, [asset.id])
}

export function setSceneGenerated(scene: Scene, index: number): void {
  scene.background = createGeneratedBackground('linear', paletteFor(index), hashString(scene.id))
  if (scene.motion.preset === 'parallax') scene.motion = defaultMotion('generated')
}

export function addOverlay(scene: Scene, overlay: TextOverlay): void {
  scene.overlays.push(overlay)
}

export function removeOverlay(scene: Scene, overlayId: string): void {
  scene.overlays = scene.overlays.filter((o) => o.id !== overlayId)
}

export function addAssetIds(project: Project, ids: readonly string[]): void {
  const existing = new Set(project.assetIds)
  for (const id of ids) {
    if (!existing.has(id)) {
      project.assetIds.push(id)
      existing.add(id)
    }
  }
}

/** Where an asset is used, for "remove asset" confirmations. */
export function assetUsage(project: Project, assetId: string): { scenes: number; audioTracks: number; logo: boolean } {
  let scenes = 0
  for (const s of project.scenes) {
    if ((s.background.kind === 'media' && s.background.assetId === assetId) || s.audio?.assetId === assetId) scenes++
  }
  return {
    scenes,
    audioTracks: project.audioTracks.filter((t) => t.assetId === assetId).length,
    logo: project.brand.logoAssetId === assetId,
  }
}

/** Remove an asset from the bin and detach every reference to it (backgrounds fall back to a gradient). */
export function removeAsset(project: Project, assetId: string): void {
  project.assetIds = project.assetIds.filter((id) => id !== assetId)
  project.scenes.forEach((scene, i) => {
    if (scene.background.kind === 'media' && scene.background.assetId === assetId) setSceneGenerated(scene, i)
    if (scene.audio?.assetId === assetId) scene.audio = null
  })
  project.audioTracks = project.audioTracks.filter((t) => t.assetId !== assetId)
  if (project.brand.logoAssetId === assetId) project.brand.logoAssetId = null
}

export function addAudioTrack(
  project: Project,
  asset: Pick<AssetMeta, 'id' | 'duration'>,
  role: AudioRole,
  start = 0,
): AudioTrack {
  const track = createAudioTrack(asset, role, start)
  project.audioTracks.push(track)
  addAssetIds(project, [asset.id])
  return track
}

export function setAspectRatio(project: Project, aspect: AspectRatio): void {
  project.aspectRatio = aspect
}

/** Replace or append storyboard scenes in one undoable step. */
export function applyStoryboard(project: Project, scenes: Scene[], mode: 'replace' | 'append'): void {
  if (mode === 'replace') project.scenes = []
  addScenes(project, scenes)
}
