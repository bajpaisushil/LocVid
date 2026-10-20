import { duplicateScene, moveScene, removeScene } from '@/core/operations'
import type { TimelineEntry } from '@/core/timeline'
import { useEditorStore } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'

/** Seek so the preview shows a scene itself, not the transition into it. */
export function seekToScene(entry: TimelineEntry) {
  usePlaybackStore.getState().pause()
  usePlaybackStore.getState().seek(entry.start + entry.inDuration / 2 + 0.01)
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

