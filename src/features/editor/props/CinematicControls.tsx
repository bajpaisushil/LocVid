import { Box, CheckCircle2, Download, Loader2, Sparkles, X } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { Atmosphere, CameraMove, CinematicSettings, FocusMode, GradePreset, LookSettings, Scene } from '@/core/types'
import { formatBytes } from '@/lib/format'
import { useDepthModel } from '@/features/ai/depthModelStore'
import { useEditorStore, useProject } from '@/state/editorStore'
import { SegmentedField, SelectField, Section, SliderField, SwitchField } from '../fields'
import { ATMOSPHERE_OPTIONS, CAMERA_OPTIONS, GRADE_OPTIONS, useSceneUpdate } from './shared'


const FOCUS_OPTIONS: { value: FocusMode; label: string }[] = [
  { value: 'none', label: 'Everything sharp' },
  { value: 'subject', label: 'Focus on subject' },
  { value: 'rack', label: 'Rack focus (pull to subject)' },
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
