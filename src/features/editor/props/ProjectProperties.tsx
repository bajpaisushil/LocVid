import { Stamp } from 'lucide-react'
import { outputDimensions } from '@/core/defaults'
import { setAspectRatio } from '@/core/operations'
import { totalDuration } from '@/core/timeline'
import type { AspectRatio, Corner, FrameRate, ResolutionPreset } from '@/core/types'
import { MAX_PROJECT_DURATION } from '@/core/types'
import { formatTime } from '@/lib/format'
import { useEditorStore, useProject } from '@/state/editorStore'
import { Field, SegmentedField, SelectField, Section, SliderField } from '../fields'

export function ProjectProperties() {
  const project = useProject()
  const assets = useEditorStore((s) => s.assets)
  const apply = useEditorStore((s) => s.apply)
  const images = project.assetIds.map((id) => assets[id]?.meta).filter((m) => m?.kind === 'image')
  const duration = totalDuration(project.scenes)
  const { width, height } = outputDimensions(project.aspectRatio, project.output.resolution)

  return (
    <div data-testid="project-properties">
      <div className="border-b px-3 py-3">
        <p className="text-sm font-medium">Project settings</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Select a scene, text or audio clip on the timeline to edit it. {project.scenes.length} scenes · {formatTime(duration)} of{' '}
          {formatTime(MAX_PROJECT_DURATION, false)} max.
        </p>
      </div>
      <Section title="Format">
        <SegmentedField<AspectRatio>
          label="Aspect ratio"
          value={project.aspectRatio}
          options={[
            { value: '16:9', label: '16:9', title: 'Landscape (YouTube)' },
            { value: '9:16', label: '9:16', title: 'Vertical (Shorts, Reels, TikTok)' },
            { value: '1:1', label: '1:1', title: 'Square' },
          ]}
          onChange={(aspect) => apply((d) => setAspectRatio(d, aspect))}
          testId="aspect-ratio"
        />
        <div className="grid grid-cols-2 gap-2">
          <SelectField<ResolutionPreset>
            label="Export resolution"
            value={project.output.resolution}
            options={[
              { value: '720p', label: '720p' },
              { value: '1080p', label: '1080p' },
            ]}
            onChange={(resolution) => apply((d) => void (d.output.resolution = resolution))}
          />
          <SelectField<string>
            label="Frame rate"
            value={String(project.output.fps)}
            options={[
              { value: '24', label: '24 fps' },
              { value: '25', label: '25 fps' },
              { value: '30', label: '30 fps' },
            ]}
            onChange={(fps) => apply((d) => void (d.output.fps = Number(fps) as FrameRate))}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Output: {width}×{height}. 720p is recommended; 1080p exports take about twice as long and need more memory.
        </p>
        <SliderField
          label="Fade to black at the end"
          value={project.fadeOutEnd}
          min={0}
          max={5}
          step={0.1}
          format={(v) => (v === 0 ? 'Off' : `${v.toFixed(1)}s`)}
          onChange={(v) => apply((d) => void (d.fadeOutEnd = v), { coalesce: 'fadeout-end' })}
        />
      </Section>
      <Section title="Logo watermark">
        <SelectField<string>
          label="Logo image"
          value={project.brand.logoAssetId ?? '__none'}
          options={[
            { value: '__none', label: images.length ? 'None' : 'None (import a logo image first)' },
            ...images.map((m) => ({ value: m!.id, label: m!.name })),
          ]}
          onChange={(v) => apply((d) => void (d.brand.logoAssetId = v === '__none' ? null : v))}
          testId="logo-select"
        />
        {project.brand.logoAssetId ? (
          <>
            <SegmentedField<Corner>
              label="Corner"
              value={project.brand.position}
              options={[
                { value: 'top-left', label: '↖', title: 'Top left' },
                { value: 'top-right', label: '↗', title: 'Top right' },
                { value: 'bottom-left', label: '↙', title: 'Bottom left' },
                { value: 'bottom-right', label: '↘', title: 'Bottom right' },
              ]}
              onChange={(position) => apply((d) => void (d.brand.position = position))}
            />
            <SliderField
              label="Size"
              value={project.brand.size}
              min={0.04}
              max={0.3}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => apply((d) => void (d.brand.size = v), { coalesce: 'logo-size' })}
            />
            <SliderField
              label="Opacity"
              value={project.brand.opacity}
              min={0.1}
              max={1}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => apply((d) => void (d.brand.opacity = v), { coalesce: 'logo-opacity' })}
            />
          </>
        ) : (
          <Field label="">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Stamp className="size-3.5" /> Tip: transparent PNG or SVG logos look best.
            </p>
          </Field>
        )}
      </Section>
    </div>
  )
}
