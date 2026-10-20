import { duplicateScene, moveScene, removeScene } from '@/core/operations'
import type { TimelineEntry } from '@/core/timeline'
import { useEditorStore } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'

/** Seek so the preview shows a scene itself, not the transition into it (nor the first scene's fade from black). */
export function seekToScene(entry: TimelineEntry) {
  usePlaybackStore.getState().pause()
  const { scene } = entry
  const openingFade = entry.start === 0 && scene.transition.type !== 'none' ? Math.min(scene.transition.duration, scene.duration * 0.5) : 0
  usePlaybackStore.getState().seek(entry.start + Math.max(entry.inDuration / 2, openingFade) + 0.01)
}

export function sceneActions() {
  const { apply, select } = useEditorStore.getState()
  return {
    duplicate(sceneId: string) {
      let id: string | null = null
      apply((d) => {
        id = duplicateScene(d, sceneId)
      })
      if (id) select({ kind: 'scene', sceneId: id })
    },
    remove(sceneId: string) {
      apply((d) => removeScene(d, sceneId))
    },
    move(sceneId: string, delta: number) {
      apply((d) => {
        const i = d.scenes.findIndex((s) => s.id === sceneId)
        if (i >= 0) moveScene(d, i, i + delta)
      })
    },
  }
}

