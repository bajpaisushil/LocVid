import type { Draft } from 'immer'
import type { MotionPreset, Scene, TextStylePreset, TransitionType } from '@/core/types'
import { useEditorStore } from '@/state/editorStore'

export const TEXT_PRESETS: { value: TextStylePreset; label: string; sample: string }[] = [
  { value: 'title', label: 'Title', sample: 'Your title' },
  { value: 'subtitle', label: 'Subtitle', sample: 'A short subtitle' },
  { value: 'caption', label: 'Caption', sample: 'Caption text' },
  { value: 'lowerThird', label: 'Lower third', sample: 'Name · Role' },
  { value: 'quote', label: 'Quote', sample: '“A memorable quote.”' },
]

export function useSceneUpdate(sceneId: string) {
  const apply = useEditorStore((s) => s.apply)
  return (recipe: (scene: Draft<Scene>) => void, coalesce?: string) =>
    apply(
      (d) => {
        const scene = d.scenes.find((s) => s.id === sceneId)
        if (scene) recipe(scene)
      },
      coalesce ? { coalesce: `${coalesce}:${sceneId}` } : undefined,
    )
}


export const MOTION_OPTIONS: { value: MotionPreset; label: string }[] = [
  { value: 'none', label: 'None (static)' },
  { value: 'kenBurns', label: 'Ken Burns (zoom + drift)' },
  { value: 'zoomIn', label: 'Zoom in' },
  { value: 'zoomOut', label: 'Zoom out' },
  { value: 'panLeft', label: 'Pan left' },
  { value: 'panRight', label: 'Pan right' },
  { value: 'panUp', label: 'Pan up' },
  { value: 'panDown', label: 'Pan down' },
  { value: 'parallax', label: 'Parallax card (2.5D)' },
]

export const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'none', label: 'Cut (none)' },
  { value: 'crossfade', label: 'Crossfade' },
  { value: 'fadeBlack', label: 'Dip to black' },
  { value: 'fadeWhite', label: 'Dip to white' },
  { value: 'slideLeft', label: 'Slide left' },
  { value: 'slideRight', label: 'Slide right' },
  { value: 'slideUp', label: 'Slide up' },
  { value: 'slideDown', label: 'Slide down' },
  { value: 'wipeLeft', label: 'Wipe left' },
  { value: 'wipeRight', label: 'Wipe right' },
  { value: 'zoom', label: 'Zoom through' },
]

