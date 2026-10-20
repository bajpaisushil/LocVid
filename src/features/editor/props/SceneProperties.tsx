import { Clock, ImageIcon, Plus, Shuffle, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { aspectValue, createGeneratedBackground, createOverlay, paletteFor } from '@/core/defaults'
import { setSceneDuration, setSceneGenerated, setSceneMedia } from '@/core/operations'
import type {
  ContainFill,
  CropRect,
  Easing,
  FitMode,
  GeneratedStyle,
  MotionPreset,
  TextStylePreset,
  TransitionType,
} from '@/core/types'
import { MAX_SCENE_DURATION, MAX_TRANSITION_DURATION, MIN_SCENE_DURATION } from '@/core/types'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { controlsFromCrop, cropFromControls } from '@/render/fit'
import { useEditorStore, useProject } from '@/state/editorStore'
import { ColorField, Field, NumberField, SegmentedField, SelectField, Section, SliderField, SwitchField } from '../fields'
import { LookSection, MotionControls } from './CinematicControls'
import { OverlayEditor } from './OverlayEditor'
import { MOTION_OPTIONS, TEXT_PRESETS, TRANSITION_OPTIONS, useSceneUpdate } from './shared'

const EASING_OPTIONS: { value: Easing; label: string }[] = [
  { value: 'easeInOut', label: 'Ease in & out' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeIn', label: 'Ease in' },
  { value: 'linear', label: 'Linear' },
]

const INTRO_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'none', label: 'None — start on the first frame' },
  { value: 'fadeBlack', label: 'Fade in from black' },
  { value: 'fadeWhite', label: 'Fade in from white' },
]

const STYLE_OPTIONS: { value: GeneratedStyle; label: string }[] = [
  { value: 'linear', label: 'Linear gradient' },
  { value: 'radial', label: 'Radial glow' },
  { value: 'aurora', label: 'Aurora' },
  { value: 'bokeh', label: 'Bokeh lights' },
  { value: 'particles', label: 'Floating particles' },
  { value: 'waves', label: 'Waves' },
  { value: 'grid', label: 'Retro grid' },
  { value: 'solid', label: 'Solid color' },
]

export function SceneProperties({ sceneId, overlayId }: { sceneId: string; overlayId: string | null }) {
  const project = useProject()
  const assets = useEditorStore((s) => s.assets)
  const select = useEditorStore((s) => s.select)
  const index = project.scenes.findIndex((s) => s.id === sceneId)
  const scene = project.scenes[index]
  const update = useSceneUpdate(sceneId)
  if (!scene) return null
  const bg = scene.background
  const media = bg.kind === 'media' ? assets[bg.assetId]?.meta : undefined
  const voiceMeta = scene.audio ? assets[scene.audio.assetId]?.meta : undefined
  const visualAssets = project.assetIds.map((id) => assets[id]).filter((a) => a && a.meta.kind !== 'audio')
  const audioAssets = project.assetIds.map((id) => assets[id]).filter((a) => a && a.meta.kind === 'audio')

  const addText = (style: TextStylePreset) => {
    const preset = TEXT_PRESETS.find((p) => p.value === style)!
    const overlay = createOverlay(preset.sample, style, project.aspectRatio)
    update((s) => void s.overlays.push(overlay))
    select({ kind: 'overlay', sceneId, overlayId: overlay.id })
  }

  return (
    <div data-testid="scene-properties">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-b px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular">Scene {index + 1}</span>
          <Input
            aria-label="Scene title"
            value={scene.title}
            maxLength={120}
            className="h-8 text-sm"
            onChange={(e) => update((s) => void (s.title = e.target.value), 'title')}
            data-testid="scene-title"
          />
        </div>
        <div className="grid grid-cols-2 items-end gap-2">
          <NumberField
            label="Duration"
            suffix="s"
            value={scene.duration}
            min={MIN_SCENE_DURATION}
            max={MAX_SCENE_DURATION}
            step={0.1}
            onCommit={(v) => v !== null && update((s) => setSceneDuration(s, v))}
            testId="scene-duration-input"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Clock /> Fit to…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!(media?.kind === 'video' && media.duration)}
                onSelect={() =>
                  media?.duration && update((s) => setSceneDuration(s, media.duration! - (bg.kind === 'media' ? bg.trimStart : 0)))
                }
              >
                Video clip length{media?.kind === 'video' && media.duration ? ` (${formatDuration(media.duration)})` : ''}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!voiceMeta?.duration}
                onSelect={() => voiceMeta?.duration && update((s) => setSceneDuration(s, voiceMeta.duration! + (s.audio?.offset ?? 0) + 0.3))}
              >
                Voice-over length{voiceMeta?.duration ? ` (${formatDuration(voiceMeta.duration)})` : ''}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!scene.notes.trim() && !scene.overlays.some((o) => o.text.trim())}
                onSelect={() => {
                  const words = (scene.notes || scene.overlays.map((o) => o.text).join(' ')).split(/\s+/).filter(Boolean).length
                  update((s) => setSceneDuration(s, Math.max(2.5, (words / 150) * 60 + 1)))
                }}
              >
                Reading time of the text (150 wpm)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Field label="Script / notes" hint="For your narration. Not shown in the video unless added as text.">
          <Textarea
            value={scene.notes}
            rows={2}
            maxLength={20000}
            className="min-h-14 text-sm"
            placeholder="What happens in this scene…"
            onChange={(e) => update((s) => void (s.notes = e.target.value), 'notes')}
          />
        </Field>
      </div>

      <Section title="Background">
        <div className="flex items-center gap-2">
          <div
            className="size-12 shrink-0 rounded-md border bg-cover bg-center"
            style={
              bg.kind === 'media'
                ? { backgroundImage: assets[bg.assetId]?.thumbnailUrl ? `url(${assets[bg.assetId]!.thumbnailUrl})` : undefined }
                : { backgroundImage: `linear-gradient(135deg, ${bg.colors[0]}, ${bg.colors[1] ?? bg.colors[0]})` }
            }
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{bg.kind === 'media' ? (media?.name ?? 'Missing media') : 'Generated background'}</p>
            <p className="text-xs text-muted-foreground">
              {bg.kind === 'media'
                ? media
                  ? `${media.kind === 'video' ? 'Video' : 'Image'}${media.width ? ` · ${media.width}×${media.height}` : ''}`
                  : 'Re-import the file, then choose it here'
                : STYLE_OPTIONS.find((o) => o.value === bg.style)?.label}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="replace-media">
                <ImageIcon /> Change
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
              <DropdownMenuLabel className="text-xs">Use media from this project</DropdownMenuLabel>
              {visualAssets.length === 0 ? (
                <DropdownMenuItem disabled>Import images or videos first</DropdownMenuItem>
              ) : (
                visualAssets.map((a) => (
                  <DropdownMenuItem key={a!.meta.id} onSelect={() => useEditorStore.getState().apply((d) => setSceneMedia(d, sceneId, a!.meta))}>
                    {a!.thumbnailUrl ? <img src={a!.thumbnailUrl} alt="" className="size-6 rounded object-cover" /> : null}
                    <span className="truncate">{a!.meta.name}</span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => update((s) => setSceneGenerated(s, index))}>
                <Wand2 /> Generated gradient
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {bg.kind === 'media' ? (
          <>
            <SegmentedField<FitMode>
              label="Fit"
              value={bg.fit}
              options={[
                { value: 'cover', label: 'Cover', title: 'Fill the frame, trimming edges' },
                { value: 'contain', label: 'Contain', title: 'Show everything, with a backdrop' },
                { value: 'crop', label: 'Crop', title: 'Choose the framing yourself' },
              ]}
              onChange={(fit) => update((s) => void (s.background.kind === 'media' && (s.background.fit = fit)))}
              testId="fit-mode"
            />
            {bg.fit === 'contain' ? (
              <>
                <SegmentedField<ContainFill>
                  label="Backdrop"
                  value={bg.fill}
                  options={[
                    { value: 'blur', label: 'Blurred' },
                    { value: 'black', label: 'Black' },
                    { value: 'color', label: 'Color' },
                  ]}
                  onChange={(fill) => update((s) => void (s.background.kind === 'media' && (s.background.fill = fill)))}
                />
                {bg.fill === 'color' ? (
                  <ColorField
                    label="Backdrop color"
                    value={bg.fillColor}
                    onChange={(c) => update((s) => void (s.background.kind === 'media' && (s.background.fillColor = c)), 'fill')}
                  />
                ) : null}
              </>
            ) : null}
            {bg.fit === 'crop' && media?.width && media.height ? (
              <CropControls
                crop={bg.crop}
                width={media.width}
                height={media.height}
                aspect={aspectValue(project.aspectRatio)}
                onChange={(crop) => update((s) => void (s.background.kind === 'media' && (s.background.crop = crop)), 'crop')}
              />
            ) : null}
            {media?.kind === 'video' ? (
              <>
                <SliderField
                  label="Start clip at"
                  value={bg.trimStart}
                  min={0}
                  max={Math.max(0, (media.duration ?? 0) - 0.1)}
                  step={0.05}
                  format={(v) => `${v.toFixed(2)}s`}
                  onChange={(v) => update((s) => void (s.background.kind === 'media' && (s.background.trimStart = v)), 'trim')}
                />
                <SliderField
                  label="Clip volume"
                  value={bg.volume}
                  min={0}
                  max={1}
                  format={(v) => (v === 0 ? 'Muted' : `${Math.round(v * 100)}%`)}
                  onChange={(v) => update((s) => void (s.background.kind === 'media' && (s.background.volume = v)), 'clipvol')}
                />
                {media.hasAudio === false ? <p className="text-[11px] text-muted-foreground">This clip has no audio track.</p> : null}
                <SwitchField
                  label="Loop clip"
                  hint="Repeat if the scene is longer than the clip; otherwise hold the last frame."
                  checked={bg.loop}
                  onChange={(loop) => update((s) => void (s.background.kind === 'media' && (s.background.loop = loop)))}
                />
              </>
            ) : null}
          </>
        ) : (
          <>
            <SelectField<GeneratedStyle>
              label="Style"
              value={bg.style}
              options={STYLE_OPTIONS}
              onChange={(style) => update((s) => void (s.background.kind === 'generated' && (s.background.style = style)))}
              testId="generated-style"
            />
            <div className="grid grid-cols-2 gap-2">
              <ColorField
                label="Color 1"
                value={bg.colors[0] ?? '#4f46e5'}
                onChange={(c) => update((s) => void (s.background.kind === 'generated' && (s.background.colors[0] = c)), 'c1')}
              />
              <ColorField
                label="Color 2"
                value={bg.colors[1] ?? bg.colors[0] ?? '#ec4899'}
                onChange={(c) => update((s) => void (s.background.kind === 'generated' && (s.background.colors[1] = c)), 'c2')}
              />
            </div>
            {bg.style === 'linear' ? (
              <SliderField
                label="Angle"
                value={bg.angle}
                min={0}
                max={360}
                step={1}
                format={(v) => `${Math.round(v)}°`}
                onChange={(v) => update((s) => void (s.background.kind === 'generated' && (s.background.angle = v)), 'angle')}
              />
            ) : null}
            <SwitchField
              label="Animate"
              checked={bg.animate}
              onChange={(animate) => update((s) => void (s.background.kind === 'generated' && (s.background.animate = animate)))}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                update((s) => {
                  if (s.background.kind !== 'generated') return
                  const next = createGeneratedBackground(s.background.style, paletteFor(Math.floor(Math.random() * 1000)), Math.floor(Math.random() * 1e9))
                  s.background.colors = next.colors
                  s.background.seed = next.seed
                })
              }
            >
              <Shuffle /> Shuffle colors & layout
            </Button>
          </>
        )}
      </Section>

      <Section title="Motion">
        {bg.kind === 'generated' ? (
          <p className="text-[11px] text-muted-foreground">Generated backgrounds animate on their own. Camera motion applies to images and video.</p>
        ) : (
          <>
            <MotionControls scene={scene} isImage={media?.kind === 'image'} />
            {scene.cinematic.enabled && media?.kind === 'image' ? null : (
            <SelectField<MotionPreset>
              label="Camera"
              value={scene.motion.preset}
              options={MOTION_OPTIONS}
              onChange={(preset) => update((s) => void (s.motion.preset = preset))}
              testId="motion-preset"
            />
            )}
            {scene.motion.preset !== 'none' && !(scene.cinematic.enabled && media?.kind === 'image') ? (
              <>
                <SliderField
                  label="Intensity"
                  value={scene.motion.intensity}
                  min={0}
                  max={1}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => update((s) => void (s.motion.intensity = v), 'intensity')}
                />
                <SelectField<Easing>
                  label="Easing"
                  value={scene.motion.easing}
                  options={EASING_OPTIONS}
                  onChange={(easing) => update((s) => void (s.motion.easing = easing))}
                />
              </>
            ) : null}
          </>
        )}
      </Section>

      <LookSection scene={scene} />

      <Section
        title={`Text (${scene.overlays.length})`}
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="secondary" data-testid="add-text">
                <Plus /> Text
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {TEXT_PRESETS.map((p) => (
                <DropdownMenuItem key={p.value} onSelect={() => addText(p.value)} data-testid={`add-text-${p.value}`}>
                  {p.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {scene.overlays.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No text yet. Add a title, caption or lower third.</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {scene.overlays.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => select({ kind: 'overlay', sceneId, overlayId: o.id })}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition',
                    overlayId === o.id ? 'border-primary bg-primary/10' : 'hover:bg-muted/60',
                  )}
                  data-testid="overlay-item"
                >
                  <span className="rounded bg-secondary px-1 text-[10px] text-muted-foreground uppercase">{o.style}</span>
                  <span className="min-w-0 flex-1 truncate">{o.text || <em className="text-muted-foreground">Empty</em>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {overlayId ? <OverlayEditor key={overlayId} sceneId={sceneId} overlayId={overlayId} /> : null}
      </Section>

      <Section title={index === 0 ? 'Intro' : 'Transition in'} id="section-transition">
        <SelectField<TransitionType>
          label={index === 0 ? 'How the video starts' : `From scene ${index} into this scene`}
          value={index === 0 && !['none', 'fadeBlack', 'fadeWhite'].includes(scene.transition.type) ? 'fadeBlack' : scene.transition.type}
          options={index === 0 ? INTRO_OPTIONS : TRANSITION_OPTIONS}
          onChange={(type) => update((s) => void (s.transition.type = type))}
          testId="transition-type"
        />
        {scene.transition.type !== 'none' ? (
          <SliderField
            label="Duration"
            value={scene.transition.duration}
            min={0.1}
            max={MAX_TRANSITION_DURATION}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onChange={(v) => update((s) => void (s.transition.duration = v), 'transition')}
          />
        ) : null}
        {index > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Transitions overlap the cut evenly, so they never change the total length. They are capped at half of either scene.
          </p>
        ) : null}
      </Section>

      <Section title="Voice-over">
        <SelectField<string>
          label="Audio that starts with this scene"
          value={scene.audio?.assetId ?? '__none'}
          options={[
            { value: '__none', label: audioAssets.length ? 'None' : 'None (import audio first)' },
            ...audioAssets.map((a) => ({ value: a!.meta.id, label: a!.meta.name })),
          ]}
          onChange={(v) =>
            update((s) => {
              s.audio = v === '__none' ? null : { assetId: v, volume: s.audio?.volume ?? 1, offset: s.audio?.offset ?? 0 }
            })
          }
          testId="voiceover-select"
        />
        {scene.audio ? (
          <>
            <SliderField
              label="Volume"
              value={scene.audio.volume}
              min={0}
              max={1.5}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => update((s) => void (s.audio && (s.audio.volume = v)), 'vovol')}
            />
            <SliderField
              label="Start after"
              value={scene.audio.offset}
              min={0}
              max={Math.max(0, scene.duration - 0.5)}
              step={0.05}
              format={(v) => `${v.toFixed(2)}s`}
              onChange={(v) => update((s) => void (s.audio && (s.audio.offset = v)), 'vooffset')}
            />
            {voiceMeta?.duration && voiceMeta.duration + scene.audio.offset > scene.duration + 0.05 ? (
              <p className="text-[11px] text-warning">
                The voice-over ({formatDuration(voiceMeta.duration)}) is longer than the scene and will be cut. Use “Fit to… → Voice-over
                length”.
              </p>
            ) : null}
          </>
        ) : null}
      </Section>
    </div>
  )
}

function CropControls({
  crop,
  width,
  height,
  aspect,
  onChange,
}: {
  crop: CropRect
  width: number
  height: number
  aspect: number
  onChange(crop: CropRect): void
}) {
  const c = controlsFromCrop(crop, width, height, aspect)
  const set = (patch: Partial<typeof c>) => onChange(cropFromControls({ ...c, ...patch }, width, height, aspect))
  return (
    <div className="grid gap-3 rounded-md border bg-muted/30 p-2">
      <SliderField label="Crop zoom" value={c.zoom} min={1} max={4} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(zoom) => set({ zoom })} />
      <SliderField
        label="Horizontal position"
        value={c.focusX}
        min={0}
        max={1}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(focusX) => set({ focusX })}
      />
      <SliderField
        label="Vertical position"
        value={c.focusY}
        min={0}
        max={1}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(focusY) => set({ focusY })}
      />
    </div>
  )
}
