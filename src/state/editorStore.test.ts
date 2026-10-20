import { beforeEach, describe, expect, it } from 'vitest'
import { createOverlay, createProject, createScene } from '@/core/defaults'
import {
  addScenes,
  assetUsage,
  duplicateScene,
  moveScene,
  removeAsset,
  removeScene,
  setSceneDuration,
  setSceneMedia,
} from '@/core/operations'
import { buildTimeline } from '@/core/timeline'
import { useEditorStore } from './editorStore'

function openFresh() {
  const project = createProject({ name: 'Test' })
  useEditorStore.getState().open(project, [])
  return project
}

const store = () => useEditorStore.getState()
const sceneIds = () => store().project!.scenes.map((s) => s.id)

beforeEach(() => {
  store().close()
})

describe('scene operations through the store', () => {
  it('creates, edits, reorders and deletes scenes', () => {
    openFresh()
    const [a, b, c] = [createScene({ index: 0 }), createScene({ index: 1 }), createScene({ index: 2 })]
    store().apply((d) => addScenes(d, [a, b, c]))
    expect(sceneIds()).toEqual([a.id, b.id, c.id])

    store().apply((d) => setSceneDuration(d.scenes[1]!, 2.5))
    expect(store().project!.scenes[1]!.duration).toBe(2.5)
    expect(buildTimeline(store().project!).duration).toBe(12.5)

    store().apply((d) => moveScene(d, 2, 0))
    expect(sceneIds()).toEqual([c.id, a.id, b.id])

    store().apply((d) => removeScene(d, a.id))
    expect(sceneIds()).toEqual([c.id, b.id])
    expect(buildTimeline(store().project!).duration).toBe(7.5)
  })

  it('clamps scene durations to the supported range', () => {
    openFresh()
    const s = createScene()
    store().apply((d) => addScenes(d, [s]))
    store().apply((d) => setSceneDuration(d.scenes[0]!, 0.01))
    expect(store().project!.scenes[0]!.duration).toBe(0.5)
    store().apply((d) => setSceneDuration(d.scenes[0]!, 1e6))
    expect(store().project!.scenes[0]!.duration).toBe(300)
  })

  it('duplicates a scene with fresh ids right after the original', () => {
    openFresh()
    const s = createScene()
    s.overlays.push(createOverlay('Hi', 'title', '16:9'))
    store().apply((d) => addScenes(d, [s]))
    let copyId: string | null = null
    store().apply((d) => {
      copyId = duplicateScene(d, s.id)
    })
    const [orig, copy] = store().project!.scenes
    expect(copy!.id).toBe(copyId)
    expect(copy!.id).not.toBe(orig!.id)
    expect(copy!.overlays[0]!.id).not.toBe(orig!.overlays[0]!.id)
    expect(copy!.overlays[0]!.text).toBe('Hi')
  })

  it('moving a scene to the front turns its transition into a fade-in', () => {
    openFresh()
    const scenes = [createScene({ index: 0 }), createScene({ index: 1 })]
    store().apply((d) => addScenes(d, scenes))
    expect(store().project!.scenes[1]!.transition.type).toBe('crossfade')
    store().apply((d) => moveScene(d, 1, 0))
    expect(store().project!.scenes[0]!.transition.type).toBe('fadeBlack')
  })
})

describe('undo / redo', () => {
  it('undoes and redoes document changes', () => {
    openFresh()
    const s = createScene()
    store().apply((d) => addScenes(d, [s]))
    store().apply((d) => setSceneDuration(d.scenes[0]!, 8))
    store().undo()
    expect(store().project!.scenes[0]!.duration).toBe(5)
    store().undo()
    expect(store().project!.scenes).toHaveLength(0)
    store().redo()
    store().redo()
    expect(store().project!.scenes[0]!.duration).toBe(8)
  })

  it('coalesces rapid edits with the same key into one step', () => {
    openFresh()
    store().apply((d) => addScenes(d, [createScene()]))
    for (const v of [5.5, 6, 6.5, 7]) {
      store().apply((d) => setSceneDuration(d.scenes[0]!, v), { coalesce: 'duration' })
    }
    expect(store().past).toHaveLength(2)
    store().undo()
    expect(store().project!.scenes[0]!.duration).toBe(5)
  })

  it('a new edit clears the redo stack', () => {
    openFresh()
    store().apply((d) => addScenes(d, [createScene()]))
    store().undo()
    expect(store().future).toHaveLength(1)
    store().apply((d) => addScenes(d, [createScene()]))
    expect(store().future).toHaveLength(0)
  })

  it('no-op edits do not create history or mark unsaved', () => {
    openFresh()
    store().apply(() => {})
    expect(store().past).toHaveLength(0)
    expect(store().saveStatus).toBe('saved')
  })

  it('drops a selection that no longer exists after undo', () => {
    openFresh()
    const s = createScene()
    store().apply((d) => addScenes(d, [s]), { select: { kind: 'scene', sceneId: s.id } })
    expect(store().selection).toEqual({ kind: 'scene', sceneId: s.id })
    store().undo()
    expect(store().selection).toEqual({ kind: 'none' })
  })

  it('tracks revisions for autosave', () => {
    openFresh()
    store().apply((d) => addScenes(d, [createScene()]))
    expect(store().revision).toBe(1)
    expect(store().saveStatus).toBe('pending')
    store().markSaving()
    store().markSaved(1)
    expect(store().saveStatus).toBe('saved')
  })
})

describe('asset references', () => {
  it('removing an asset detaches every use of it', () => {
    openFresh()
    const s = createScene()
    store().apply((d) => {
      addScenes(d, [s])
      setSceneMedia(d, s.id, { id: 'ast_photo', kind: 'image' })
      d.scenes[0]!.audio = { assetId: 'ast_voice', volume: 1, offset: 0 }
      d.assetIds.push('ast_voice')
      d.brand.logoAssetId = 'ast_photo'
    })
    expect(assetUsage(store().project!, 'ast_photo')).toEqual({ scenes: 1, audioTracks: 0, logo: true })
    store().apply((d) => {
      removeAsset(d, 'ast_photo')
      removeAsset(d, 'ast_voice')
    })
    const p = store().project!
    expect(p.assetIds).toEqual([])
    expect(p.scenes[0]!.background.kind).toBe('generated')
    expect(p.scenes[0]!.audio).toBeNull()
    expect(p.brand.logoAssetId).toBeNull()
  })

  it('setting scene media adds the asset to the bin once', () => {
    openFresh()
    const s = createScene()
    store().apply((d) => {
      addScenes(d, [s])
      setSceneMedia(d, s.id, { id: 'ast_a', kind: 'image' })
      setSceneMedia(d, s.id, { id: 'ast_a', kind: 'image' })
    })
    expect(store().project!.assetIds).toEqual(['ast_a'])
    expect(store().project!.scenes[0]!.motion.preset).toBe('kenBurns')
  })
})
