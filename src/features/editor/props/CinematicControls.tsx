import { Box, CheckCircle2, Download, Loader2, PersonStanding, Sparkles, X } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { CUTOUT_MODEL, INPAINT_MODEL } from '@/ai/models'
import type { Atmosphere, CameraMove, CinematicSettings, FocusMode, GradePreset, LookSettings, PropKind, Scene, SubjectAction, SubjectSettings } from '@/core/types'
import { formatBytes } from '@/lib/format'
import { CUTOUT_BYTES, useCutoutModels } from '@/features/ai/cutoutModelStore'
import { useDepthModel } from '@/features/ai/depthModelStore'
import { useEditorStore, useProject } from '@/state/editorStore'
import { SegmentedField, SelectField, Section, SliderField, SwitchField } from '../fields'
import { ATMOSPHERE_OPTIONS, CAMERA_OPTIONS, GRADE_OPTIONS, useSceneUpdate } from './shared'


const FOCUS_OPTIONS: { value: FocusMode; label: string }[] = [
  { value: 'none', label: 'Everything sharp' },
  { value: 'subject', label: 'Focus on subject' },
  { value: 'rack', label: 'Rack focus (pull to subject)' },
]

const PROP_OPTIONS: { value: PropKind; label: string; needsSubject?: boolean }[] = [
  { value: 'football', label: '⚽ Football', needsSubject: true },
  { value: 'birds', label: '🕊 Birds' },
  { value: 'butterflies', label: '🦋 Butterflies' },
  { value: 'balloons', label: '🎈 Balloons' },
  { value: 'confetti', label: '🎉 Confetti' },
  { value: 'petals', label: '🌸 Petals' },
  { value: 'leaves', label: '🍂 Leaves' },
  { value: 'lanterns', label: '🏮 Lanterns' },
]

const ACTION_OPTIONS: { value: SubjectAction; label: string }[] = [
  { value: 'none', label: 'Still' },
  { value: 'breathe', label: 'Breathe (subtle, alive)' },
  { value: 'sway', label: 'Sway' },
  { value: 'walk', label: 'Walk' },
  { value: 'run', label: 'Run' },
  { value: 'jump', label: 'Jump' },
  { value: 'dance', label: 'Dance' },
  { value: 'kick', label: 'Kick' },
  { value: 'approach', label: 'Come closer' },
  { value: 'float', label: 'Float / hover' },
]


/** Download/analysis status for the depth model, with explicit consent to download. */
export function DepthGate({ assetId }: { assetId: string }) {
  const { status, manifest, loaded, total, analyzing, analyzed, check, download, cancel, analyze, refreshAnalyzed } = useDepthModel()
  const hasDepth = analyzed[assetId]
  useEffect(() => {
    if (status === 'unknown') void check()
  }, [status, check])
  useEffect(() => {
    if (analyzed[assetId] === undefined) void refreshAnalyzed([assetId])
  }, [assetId, analyzed, refreshAnalyzed])
  // Analyze automatically once the model is present.
  useEffect(() => {
    if (status === 'ready' && analyzed[assetId] === false && !analyzing.has(assetId)) void analyze(assetId)
  }, [status, analyzed, analyzing, assetId, analyze])

  if (hasDepth) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-emerald-400" data-testid="depth-ready">
        <CheckCircle2 className="size-3.5" /> Depth map ready — the camera moves through the photo in 3D.
      </p>
    )
  }
  if (analyzing.has(assetId)) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="depth-analyzing">
        <Loader2 className="size-3.5 animate-spin" /> Measuring depth on this device…
      </p>
    )
  }
  if (status === 'downloading') {
    return (
      <div className="grid gap-1">
        <Progress value={total ? (loaded / total) * 100 : 0} />
        <div className="flex items-center text-[11px] text-muted-foreground tabular">
          Downloading depth model · {formatBytes(loaded)} of {formatBytes(total)}
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Cancel download" onClick={cancel}>
            <X />
          </Button>
        </div>
      </div>
    )
  }
  if (status === 'absent' && manifest) {
    const size = manifest.files.reduce((n, f) => n + f.bytes, 0)
    return (
      <div className="grid gap-1.5 rounded-md border border-dashed p-2" data-testid="depth-gate">
        <p className="text-[11px] leading-snug text-muted-foreground">
          3D motion needs a small depth model ({manifest.name}, {formatBytes(size)}, {manifest.license.name}) that runs on this device. It
          is downloaded once from huggingface.co; your photos never leave the browser.
        </p>
        <Button size="xs" variant="secondary" className="justify-self-start" onClick={() => void download()} data-testid="depth-download">
          <Download /> Download depth model ({formatBytes(size)})
        </Button>
      </div>
    )
  }
  return <p className="text-[11px] text-muted-foreground">Checking depth model…</p>
}

/**
 * Subject animation: the cut-out models separate the subject from the
 * background and paint in what's behind it, so the subject can move.
 */
function SubjectControls({ scene, assetId }: { scene: Scene; assetId: string }) {
  const update = useSceneUpdate(scene.id)
  const depthReady = useDepthModel((s) => s.analyzed[assetId] === true)
  const { status, loaded, total, analyzing, results, looked, check, download, cancel, analyze, refresh } = useCutoutModels()
  const subject = scene.cinematic.subject
  const set = (patch: Partial<SubjectSettings>, coalesce?: string) => update((s) => void Object.assign(s.cinematic.subject, patch), coalesce)
  const result = results[assetId]
  useEffect(() => {
    if (status === 'unknown') void check()
  }, [status, check])
  useEffect(() => {
    if (!looked.has(assetId)) void refresh([assetId])
  }, [assetId, looked, refresh])
  // Cut out automatically once the models (and the depth map) are present.
  useEffect(() => {
    if (status === 'ready' && depthReady && looked.has(assetId) && result === undefined && !analyzing.has(assetId)) void analyze(assetId)
  }, [status, depthReady, looked, result, analyzing, assetId, analyze])

  if (!depthReady) return null
  let body: React.ReactNode
  if (result === 'subject') {
    body = (
      <>
        <SelectField<SubjectAction> label="Subject action" value={subject.action} options={ACTION_OPTIONS} onChange={(action) => set({ action })} testId="subject-action" />
        {subject.action !== 'none' ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <SliderField label="Amount" value={subject.amount} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(amount) => set({ amount }, 'subject-amount')} />
            <SegmentedField<'left' | 'right'>
              label="Facing"
              value={subject.direction}
              options={[
                { value: 'left', label: '←' },
                { value: 'right', label: '→' },
              ]}
              onChange={(direction) => set({ direction })}
              testId="subject-direction"
            />
          </div>
        ) : null}
      </>
    )
  } else if (result === 'none') {
    body = (
      <p className="text-[11px] text-muted-foreground" data-testid="subject-none">
        No clear subject found in this picture — the camera still moves through it in 3D.
      </p>
    )
  } else if (analyzing.has(assetId)) {
    body = (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="subject-analyzing">
        <Loader2 className="size-3.5 animate-spin" /> Cutting out the subject and painting the background behind it…
      </p>
    )
  } else if (status === 'downloading') {
    body = (
      <div className="grid gap-1">
        <Progress value={total ? (loaded / total) * 100 : 0} />
        <div className="flex items-center text-[11px] text-muted-foreground tabular">
          Downloading cut-out models · {formatBytes(loaded)} of {formatBytes(total)}
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Cancel download" onClick={cancel}>
            <X />
          </Button>
        </div>
      </div>
    )
  } else if (status === 'absent') {
    body = (
      <div className="grid gap-1.5" data-testid="subject-gate">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Make the subject move — walk, run, jump, dance. Two models run on this device: {CUTOUT_MODEL.name} ({CUTOUT_MODEL.license.name}) cuts the
          subject out, {INPAINT_MODEL.name} ({INPAINT_MODEL.license.name}) paints in the background behind it. Downloaded once from huggingface.co;
          your pictures never leave the browser.
        </p>
        <Button size="xs" variant="secondary" className="justify-self-start" onClick={() => void download()} data-testid="subject-download">
          <Download /> Download cut-out models ({formatBytes(CUTOUT_BYTES)})
        </Button>
      </div>
    )
  } else {
    body = <p className="text-[11px] text-muted-foreground">Checking cut-out models…</p>
  }
  return (
    <div className="grid gap-2 rounded-md border border-dashed p-2" data-testid="subject-section">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <PersonStanding className="size-3.5" /> Subject
        {result === 'subject' ? <CheckCircle2 className="size-3.5 text-emerald-400" data-testid="subject-ready" aria-label="Subject cut out" /> : null}
      </p>
      {body}
    </div>
  )
}

/** 3D elements placed in the shot's depth (occluded by nearer scenery). */
function PropControls({ scene, assetId }: { scene: Scene; assetId: string }) {
  const update = useSceneUpdate(scene.id)
  const hasSubject = useCutoutModels((s) => s.results[assetId] === 'subject')
  const props = scene.cinematic.props
  const toggle = (kind: PropKind) =>
    update((s) => {
      const list = s.cinematic.props
      const i = list.indexOf(kind)
      if (i >= 0) list.splice(i, 1)
      else list.push(kind)
    })
  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">Add to the shot</span>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Props" data-testid="props">
        {PROP_OPTIONS.map((o) => {
          const on = props.includes(o.value)
          const disabled = o.needsSubject && !hasSubject && !on
          return (
            <Button
              key={o.value}
              size="xs"
              variant={on ? 'secondary' : 'outline'}
              className={on ? 'border-primary/60' : undefined}
              aria-pressed={on}
              disabled={disabled}
              title={disabled ? 'Needs a cut-out subject to play with (see Subject above).' : undefined}
              onClick={() => toggle(o.value)}
              data-testid={`prop-${o.value}`}
            >
              {o.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export function MotionControls({ scene, isImage }: { scene: Scene; isImage: boolean }) {
  const update = useSceneUpdate(scene.id)
  const c = scene.cinematic
  const set = (patch: Partial<CinematicSettings>, coalesce?: string) => update((s) => void Object.assign(s.cinematic, patch), coalesce)
  if (!isImage) return null
  return (
    <>
      <SegmentedField<'2d' | '3d'>
        label="Motion type"
        value={c.enabled ? '3d' : '2d'}
        options={[
          { value: '2d', label: '2D pan & zoom' },
          { value: '3d', label: <span className="inline-flex items-center gap-1"><Box className="size-3.5" /> Cinematic 3D</span>, title: 'Depth-based camera move' },
        ]}
        onChange={(v) => set({ enabled: v === '3d' })}
        testId="motion-type"
      />
      {c.enabled && scene.background.kind === 'media' ? (
        <div className="grid gap-3 rounded-md border bg-muted/20 p-2">
          <DepthGate assetId={scene.background.assetId} />
          <SelectField<CameraMove> label="Camera move" value={c.camera} options={CAMERA_OPTIONS} onChange={(camera) => set({ camera })} testId="camera-move" />
          <SliderField label="Camera travel" value={c.intensity} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(intensity) => set({ intensity }, 'cine-intensity')} />
          <SelectField<FocusMode> label="Depth of field" value={c.focus} options={FOCUS_OPTIONS} onChange={(focus) => set({ focus })} />
          <SwitchField label="Animate sky & distance" hint="Clouds and far scenery drift slowly." checked={c.animateSky} onChange={(animateSky) => set({ animateSky })} />
          <SwitchField label="Sway foliage" hint="Grass and leaves move gently in the wind." checked={c.foliage} onChange={(foliage) => set({ foliage })} />
          <SliderField label="Atmospheric haze" value={c.haze} min={0} max={1} format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)} onChange={(haze) => set({ haze }, 'cine-haze')} />
          <SubjectControls scene={scene} assetId={scene.background.assetId} />
          <PropControls scene={scene} assetId={scene.background.assetId} />
        </div>
      ) : null}
    </>
  )
}

export function LookSection({ scene }: { scene: Scene }) {
  const project = useProject()
  const apply = useEditorStore((s) => s.apply)
  const update = useSceneUpdate(scene.id)
  const look = scene.look
  const set = (patch: Partial<LookSettings>, coalesce?: string) => update((s) => void Object.assign(s.look, patch), coalesce)
  return (
    <Section
      title="Look"
      action={
        project.scenes.length > 1 ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              apply((d) => {
                for (const s of d.scenes) s.look = { ...look }
              })
            }
            title="Use this look on every scene"
          >
            <Sparkles /> Apply to all
          </Button>
        ) : null
      }
    >
      <SelectField<GradePreset> label="Color grade" value={look.grade} options={GRADE_OPTIONS} onChange={(grade) => set({ grade })} testId="look-grade" />
      <SelectField<Atmosphere> label="Atmosphere" value={look.atmosphere} options={ATMOSPHERE_OPTIONS} onChange={(atmosphere) => set({ atmosphere })} testId="look-atmosphere" />
      <div className="grid grid-cols-3 gap-2">
        <SliderField label="Grain" value={look.grain} min={0} max={1} format={(v) => `${Math.round(v * 100)}`} onChange={(grain) => set({ grain }, 'look-grain')} />
        <SliderField label="Vignette" value={look.vignette} min={0} max={1} format={(v) => `${Math.round(v * 100)}`} onChange={(vignette) => set({ vignette }, 'look-vignette')} />
        <SliderField label="Glow" value={look.bloom} min={0} max={1} format={(v) => `${Math.round(v * 100)}`} onChange={(bloom) => set({ bloom }, 'look-bloom')} />
      </div>
      <SwitchField label="Cinema bars" hint="2.39:1 letterbox (landscape only)." checked={look.letterbox} onChange={(letterbox) => set({ letterbox })} />
    </Section>
  )
}
