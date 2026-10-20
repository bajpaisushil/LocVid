import { Mic, Music, Trash2 } from 'lucide-react'
import type { Draft } from 'immer'
import { Button } from '@/components/ui/button'
import { totalDuration } from '@/core/timeline'
import type { AudioRole, AudioTrack } from '@/core/types'
import { formatDuration } from '@/lib/format'
import { useEditorStore, useProject } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'
import { NumberField, SegmentedField, Section, SliderField, SwitchField } from '../fields'

export function AudioTrackProperties({ trackId }: { trackId: string }) {
  const project = useProject()
  const assets = useEditorStore((s) => s.assets)
  const apply = useEditorStore((s) => s.apply)
  const select = useEditorStore((s) => s.select)
  const track = project.audioTracks.find((t) => t.id === trackId)
  if (!track) return null
  const meta = assets[track.assetId]?.meta
  const projectLength = totalDuration(project.scenes)
  const update = (recipe: (t: Draft<AudioTrack>) => void, coalesce?: string) =>
    apply(
      (d) => {
        const t = d.audioTracks.find((x) => x.id === trackId)
        if (t) recipe(t)
      },
      coalesce ? { coalesce: `${coalesce}:${trackId}` } : undefined,
    )

  return (
    <div data-testid="audio-properties">
      <div className="flex items-center gap-2 border-b px-3 py-3">
        <span className="grid size-9 place-items-center rounded-md bg-emerald-900/60 text-emerald-200">
          {track.role === 'music' ? <Music className="size-4" /> : <Mic className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{meta?.name ?? 'Missing audio file'}</p>
          <p className="text-xs text-muted-foreground">{meta?.duration ? `${formatDuration(meta.duration)} source` : 'Re-import the file to relink it'}</p>
        </div>
      </div>
      <Section title="Track">
        <SegmentedField<AudioRole>
          label="Role"
          value={track.role === 'sfx' ? 'music' : track.role}
          options={[
            { value: 'music', label: 'Music' },
            { value: 'narration', label: 'Narration' },
          ]}
          onChange={(role) =>
            update((t) => {
              t.role = role
              if (role === 'narration') t.duck = false
            })
          }
        />
        <SliderField
          label="Volume"
          value={track.volume}
          min={0}
          max={1.5}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => update((t) => void (t.volume = v), 'volume')}
          testId="track-volume"
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Starts at"
            suffix="s"
            value={track.start}
            min={0}
            max={Math.max(0, projectLength)}
            step={0.1}
            onCommit={(v) => update((t) => void (t.start = v ?? 0))}
          />
          <NumberField
            label="Skip into file"
            suffix="s"
            value={track.trimStart}
            min={0}
            max={Math.max(0, (meta?.duration ?? 0) - 0.1)}
            step={0.1}
            onCommit={(v) => update((t) => void (t.trimStart = v ?? 0))}
          />
        </div>
        <NumberField
          label="Play for"
          suffix="s"
          value={track.duration}
          min={0.1}
          step={0.1}
          allowEmpty
          placeholder={track.loop ? 'Until the video ends' : 'Until the file ends'}
          onCommit={(v) => update((t) => void (t.duration = v))}
        />
        <Button variant="outline" size="sm" onClick={() => update((t) => void (t.start = Number(usePlaybackStore.getState().time.toFixed(2))))}>
          Move start to playhead
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <SliderField
            label="Fade in"
            value={track.fadeIn}
            min={0}
            max={10}
            step={0.1}
            format={(v) => `${v.toFixed(1)}s`}
            onChange={(v) => update((t) => void (t.fadeIn = v), 'fadein')}
          />
          <SliderField
            label="Fade out"
            value={track.fadeOut}
            min={0}
            max={10}
            step={0.1}
            format={(v) => `${v.toFixed(1)}s`}
            onChange={(v) => update((t) => void (t.fadeOut = v), 'fadeout')}
          />
        </div>
        <SwitchField label="Loop" hint="Repeat the file until the video ends." checked={track.loop} onChange={(v) => update((t) => void (t.loop = v))} />
        {track.role === 'music' ? (
          <SwitchField
            label="Lower under voice"
            hint="Automatically duck the music while narration, voice-overs or clip audio play."
            checked={track.duck}
            onChange={(v) => update((t) => void (t.duck = v))}
          />
        ) : null}
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            apply((d) => {
              d.audioTracks = d.audioTracks.filter((t) => t.id !== trackId)
            })
            select({ kind: 'none' })
          }}
          data-testid="delete-track"
        >
          <Trash2 /> Remove from timeline
        </Button>
      </Section>
    </div>
  )
}
