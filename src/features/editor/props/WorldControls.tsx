import { Box, Dices } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Scene, WorldBackground, WorldPlace, WorldShot, WorldTimeOfDay, WorldWeather } from '@/core/types'
import { useEditorStore } from '@/state/editorStore'
import { SelectField } from '../fields'
import { useSceneUpdate } from './shared'

const SHOT_OPTIONS: { value: WorldShot; label: string }[] = [
  { value: 'establishing', label: 'Establishing (crane in)' },
  { value: 'tracking', label: 'Tracking (alongside)' },
  { value: 'closeup', label: 'Close-up' },
  { value: 'low', label: 'Low angle' },
  { value: 'orbit', label: 'Orbit' },
  { value: 'aerial', label: 'Aerial' },
  { value: 'detail', label: 'Ground-level detail' },
  { value: 'wide', label: 'Wide (side-on)' },
  { value: 'pullback', label: 'Pull back (crane up)' },
]

const PLACE_OPTIONS: { value: WorldPlace; label: string }[] = [
  { value: 'village', label: 'Village' },
  { value: 'park', label: 'Park' },
  { value: 'beach', label: 'Beach' },
  { value: 'city', label: 'City plaza' },
  { value: 'snow', label: 'Snowy village' },
]

const TIME_OPTIONS: { value: WorldTimeOfDay; label: string }[] = [
  { value: 'morning', label: 'Morning' },
  { value: 'day', label: 'Midday' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'night', label: 'Night' },
]

const WEATHER_OPTIONS: { value: WorldWeather; label: string }[] = [
  { value: 'clear', label: 'Clear' },
  { value: 'rain', label: 'Rain' },
  { value: 'snow', label: 'Snow' },
]

/**
 * Settings of a live 3D shot. The camera belongs to this shot; the place,
 * light and weather belong to the world, so they change in every shot that
 * films the same world (the video stays continuous).
 */
export function WorldControls({ scene, bg }: { scene: Scene; bg: WorldBackground }) {
  const update = useSceneUpdate(scene.id)
  const apply = useEditorStore((s) => s.apply)
  const seed = bg.world.seed
  const setWorld = (patch: Partial<WorldBackground['world']>) =>
    apply((d) => {
      for (const s of d.scenes) if (s.background.kind === 'world' && s.background.world.seed === seed) Object.assign(s.background.world, patch)
    })
  const shots = useEditorStore((s) => s.project?.scenes.filter((x) => x.background.kind === 'world' && x.background.world.seed === seed).length ?? 1)
  return (
    <div className="grid gap-3" data-testid="world-controls">
      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <Box className="mt-0.5 size-3.5 shrink-0" />
        A live 3D scene rendered on this device: the characters, the camera and the light all move.
        {shots > 1 ? ` Place, light and weather apply to all ${shots} shots of this world.` : ''}
      </p>
      <SelectField<WorldShot>
        label="Camera shot"
        value={bg.shot}
        options={SHOT_OPTIONS}
        onChange={(shot) => update((s) => void (s.background.kind === 'world' && (s.background.shot = shot)))}
        testId="world-shot"
      />
      <div className="grid grid-cols-2 gap-2">
        <SelectField<WorldPlace> label="Place" value={bg.world.place} options={PLACE_OPTIONS} onChange={(place) => setWorld({ place })} testId="world-place" />
        <SelectField<WorldTimeOfDay> label="Time of day" value={bg.world.time} options={TIME_OPTIONS} onChange={(time) => setWorld({ time })} testId="world-time" />
      </div>
      <SelectField<WorldWeather> label="Weather" value={bg.world.weather} options={WEATHER_OPTIONS} onChange={(weather) => setWorld({ weather })} />
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => setWorld({ cast: bg.world.cast.map((c) => ({ ...c, look: Math.floor(Math.random() * 10_000) })) })}
        data-testid="world-recast"
      >
        <Dices /> New faces & outfits
      </Button>
    </div>
  )
}
