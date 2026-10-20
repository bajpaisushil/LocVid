import { AlignCenter, AlignLeft, AlignRight, Copy, Trash2 } from 'lucide-react'
import type { Draft } from 'immer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { overlayStyleDefaults } from '@/core/defaults'
import { removeOverlay } from '@/core/operations'
import type { TextAlign, TextAnimation, TextOverlay, TextStylePreset } from '@/core/types'
import { createId } from '@/lib/id'
import { cn } from '@/lib/utils'
import { FONTS, resolveFont } from '@/render/fonts'
import { useEditorStore, useProject } from '@/state/editorStore'
import { ColorField, Field, NumberField, SegmentedField, SelectField, SliderField, SwitchField } from '../fields'
import { TEXT_PRESETS, useSceneUpdate } from './shared'

const ANIMATIONS: { value: TextAnimation; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slideUp', label: 'Slide up' },
  { value: 'slideDown', label: 'Slide down' },
  { value: 'pop', label: 'Pop' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'wordByWord', label: 'Word by word' },
]

const OUT_ANIMATIONS = ANIMATIONS.filter((a) => ['none', 'fade', 'slideUp', 'slideDown', 'pop'].includes(a.value))

/** 3×3 anchor grid for quick placement. */
const POSITIONS: { x: number; y: number; align: TextAlign; label: string }[] = [
  { x: 0.06, y: 0.12, align: 'left', label: 'Top left' },
  { x: 0.5, y: 0.12, align: 'center', label: 'Top center' },
  { x: 0.94, y: 0.12, align: 'right', label: 'Top right' },
  { x: 0.06, y: 0.5, align: 'left', label: 'Middle left' },
  { x: 0.5, y: 0.5, align: 'center', label: 'Center' },
  { x: 0.94, y: 0.5, align: 'right', label: 'Middle right' },
  { x: 0.06, y: 0.86, align: 'left', label: 'Bottom left' },
  { x: 0.5, y: 0.86, align: 'center', label: 'Bottom center' },
  { x: 0.94, y: 0.86, align: 'right', label: 'Bottom right' },
]

export function OverlayEditor({ sceneId, overlayId }: { sceneId: string; overlayId: string }) {
  const project = useProject()
  const select = useEditorStore((s) => s.select)
  const updateScene = useSceneUpdate(sceneId)
  const scene = project.scenes.find((s) => s.id === sceneId)
  const overlay = scene?.overlays.find((o) => o.id === overlayId)
  if (!scene || !overlay) return null

  const update = (recipe: (o: Draft<TextOverlay>) => void, coalesce?: string) =>
    updateScene((s) => {
      const o = s.overlays.find((x) => x.id === overlayId)
      if (o) recipe(o)
    }, coalesce ? `${coalesce}:${overlayId}` : undefined)

  const font = resolveFont(overlay.fontFamily)

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border bg-card/60 p-2.5" data-testid="overlay-editor">
      <Field label="Text">
        <Textarea
          value={overlay.text}
          rows={2}
          maxLength={2000}
          className="min-h-14 text-sm"
          onChange={(e) => update((o) => void (o.text = e.target.value), 'text')}
          data-testid="overlay-text"
          autoFocus={!overlay.text}
        />
      </Field>
      <SelectField<TextStylePreset>
        label="Style preset"
        value={overlay.style}
        options={[...TEXT_PRESETS.map((p) => ({ value: p.value, label: p.label })), { value: 'custom', label: 'Custom' }]}
        onChange={(style) =>
          update((o) => {
            if (style === 'custom') {
              o.style = 'custom'
              return
            }
            Object.assign(o, overlayStyleDefaults(style, project.aspectRatio))
          })
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <SelectField<string>
          label="Font"
          value={font.id}
          options={FONTS.map((f) => ({ value: f.id, label: f.label }))}
          onChange={(fontFamily) =>
            update((o) => {
              o.fontFamily = fontFamily
              o.style = 'custom'
            })
          }
          testId="overlay-font"
        />
        <SelectField<string>
          label="Weight"
          value={String(font.weights.reduce((best, w) => (Math.abs(w - overlay.fontWeight) < Math.abs(best - overlay.fontWeight) ? w : best)))}
          options={font.weights.map((w) => ({ value: String(w), label: weightLabel(w) }))}
          onChange={(w) => update((o) => void (o.fontWeight = Number(w)))}
        />
      </div>
      <SliderField
        label="Size"
        value={overlay.fontSize}
        min={0.02}
        max={0.25}
        step={0.001}
        format={(v) => `${Math.round(v * 1000) / 10}%`}
        onChange={(v) => update((o) => void (o.fontSize = v), 'size')}
        testId="overlay-size"
      />
      <div className="grid grid-cols-2 gap-2">
        <ColorField label="Color" value={overlay.color} onChange={(c) => update((o) => void (o.color = c), 'color')} />
        <SegmentedField<TextAlign>
          label="Align"
          value={overlay.align}
          options={[
            { value: 'left', label: <AlignLeft className="size-3.5" />, title: 'Align left' },
            { value: 'center', label: <AlignCenter className="size-3.5" />, title: 'Align center' },
            { value: 'right', label: <AlignRight className="size-3.5" />, title: 'Align right' },
          ]}
          onChange={(align) => update((o) => void (o.align = align))}
        />
      </div>
      <Field label="Position" hint="Or drag the text in the preview.">
        <div className="grid grid-cols-[auto_1fr] items-start gap-3">
          <div className="grid w-[4.5rem] grid-cols-3 gap-1" role="group" aria-label="Quick position">
            {POSITIONS.map((p) => {
              const active = Math.abs(overlay.x - p.x) < 0.02 && Math.abs(overlay.y - p.y) < 0.02
              return (
                <button
                  key={p.label}
                  type="button"
                  title={p.label}
                  aria-label={p.label}
                  className={cn('size-5 rounded-sm border transition', active ? 'border-primary bg-primary' : 'bg-muted hover:bg-muted-foreground/40')}
                  onClick={() =>
                    update((o) => {
                      o.x = p.x
                      o.y = p.y
                      o.align = p.align
                    })
                  }
                />
              )
            })}
          </div>
          <div className="grid gap-2">
            <SliderField label="X" value={overlay.x} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((o) => void (o.x = v), 'x')} />
            <SliderField label="Y" value={overlay.y} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((o) => void (o.y = v), 'y')} />
          </div>
        </div>
      </Field>
      <SliderField
        label="Box width"
        value={overlay.maxWidth}
        min={0.2}
        max={1}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update((o) => void (o.maxWidth = v), 'width')}
      />
      <SwitchField label="UPPERCASE" checked={overlay.uppercase} onChange={(v) => update((o) => void (o.uppercase = v))} />
      <SwitchField
        label="Background box"
        checked={overlay.background.enabled}
        onChange={(v) => update((o) => void (o.background.enabled = v))}
        testId="overlay-box"
      />
      {overlay.background.enabled ? (
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Box color" value={overlay.background.color} onChange={(c) => update((o) => void (o.background.color = c), 'boxcolor')} />
          <SliderField
            label="Box opacity"
            value={overlay.background.opacity}
            min={0}
            max={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => update((o) => void (o.background.opacity = v), 'boxopacity')}
          />
        </div>
      ) : null}
      <SwitchField label="Outline" checked={overlay.outline.enabled} onChange={(v) => update((o) => void (o.outline.enabled = v))} />
      {overlay.outline.enabled ? (
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Outline color" value={overlay.outline.color} onChange={(c) => update((o) => void (o.outline.color = c), 'outlinecolor')} />
          <SliderField
            label="Thickness"
            value={overlay.outline.width}
            min={0.01}
            max={0.25}
            onChange={(v) => update((o) => void (o.outline.width = v), 'outlinewidth')}
          />
        </div>
      ) : null}
      <SwitchField label="Shadow" checked={overlay.shadow.enabled} onChange={(v) => update((o) => void (o.shadow.enabled = v))} />
      <div className="grid grid-cols-2 gap-2">
        <SelectField<TextAnimation>
          label="Animate in"
          value={overlay.animationIn}
          options={ANIMATIONS}
          onChange={(v) => update((o) => void (o.animationIn = v))}
          testId="overlay-anim-in"
        />
        <SelectField<TextAnimation>
          label="Animate out"
          value={OUT_ANIMATIONS.some((a) => a.value === overlay.animationOut) ? overlay.animationOut : 'fade'}
          options={OUT_ANIMATIONS}
          onChange={(v) => update((o) => void (o.animationOut = v))}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Appears at"
          suffix="s"
          value={overlay.start}
          min={0}
          max={Math.max(0, scene.duration - 0.1)}
          step={0.1}
          onCommit={(v) => update((o) => void (o.start = v ?? 0))}
        />
        <NumberField
          label="Disappears at"
          suffix="s"
          value={overlay.end}
          min={0.1}
          max={scene.duration}
          step={0.1}
          allowEmpty
          placeholder="Scene end"
          onCommit={(v) => update((o) => void (o.end = v !== null && v > o.start ? v : null))}
        />
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => {
            const copy = { ...structuredClone(overlay), id: createId('txt'), y: Math.min(0.95, overlay.y + 0.08) }
            updateScene((s) => void s.overlays.push(copy))
            select({ kind: 'overlay', sceneId, overlayId: copy.id })
          }}
        >
          <Copy /> Duplicate
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="flex-1"
          onClick={() => {
            updateScene((s) => removeOverlay(s, overlayId))
            select({ kind: 'scene', sceneId })
          }}
          data-testid="delete-overlay"
        >
          <Trash2 /> Delete text
        </Button>
      </div>
    </div>
  )
}

function weightLabel(w: number): string {
  return { 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' }[w] ?? String(w)
}
