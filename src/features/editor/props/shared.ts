import type { Draft } from 'immer'
import type { Atmosphere, CameraMove, GradePreset, MotionPreset, Scene, TextStylePreset, TransitionType } from '@/core/types'
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


export const CAMERA_OPTIONS: { value: CameraMove; label: string }[] = [
  { value: 'dollyIn', label: 'Dolly in (push toward subject)' },
  { value: 'dollyOut', label: 'Dolly out (pull back)' },
  { value: 'orbitRight', label: 'Orbit right (around subject)' },
  { value: 'orbitLeft', label: 'Orbit left' },
  { value: 'craneUp', label: 'Crane up' },
  { value: 'craneDown', label: 'Crane down' },
  { value: 'truckRight', label: 'Track right (sideways)' },
  { value: 'truckLeft', label: 'Track left' },
  { value: 'float', label: 'Handheld float' },
  { value: 'vertigo', label: 'Dolly zoom (vertigo)' },
]

export const GRADE_OPTIONS: { value: GradePreset; label: string }[] = [
  { value: 'none', label: 'Original' },
  { value: 'cinematic', label: 'Cinematic (teal & orange)' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
  { value: 'vivid', label: 'Vivid' },
  { value: 'dreamy', label: 'Dreamy' },
  { value: 'vintage', label: 'Vintage film' },
  { value: 'noir', label: 'Noir (black & white)' },
]

export const ATMOSPHERE_OPTIONS: { value: Atmosphere; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'dust', label: 'Floating dust' },
  { value: 'snow', label: 'Snow' },
  { value: 'rain', label: 'Rain' },
  { value: 'fireflies', label: 'Fireflies' },
  { value: 'embers', label: 'Embers' },
  { value: 'sparkles', label: 'Sparkles' },
]
