import { Box, Download, Info, Sparkles, Wand2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { detectDeviceCapabilities } from '@/ai/capabilities'
import { imageGen } from '@/ai/imagegen/client'
import { isModelDownloaded } from '@/ai/modelStore'
import { SD_TURBO } from '@/ai/models'
import { analyzeDepth } from '@/ai/vision/depth'
import { createAudioTrack, createGeneratedBackground, createOverlay, createScene, defaultCinematic, outputDimensions, paletteFor } from '@/core/defaults'
import { applyStoryboard } from '@/core/operations'
import { atmosphereForPrompt, directShot, framingCrop, lookForStyle } from '@/core/storyboard/direction'
import { planVideo, STYLE_LABELS, type PlannedShot, type VisualStyle } from '@/core/storyboard/promptPlan'
import type { AssetMeta, GeneratedStyle, Scene } from '@/core/types'
import { errorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { hashString } from '@/lib/id'
import { cn } from '@/lib/utils'
import { useDepthModel } from '@/features/ai/depthModelStore'
import { getPreviewEngine } from '@/features/editor/previewRegistry'
import type { DepthAnalysis } from '@/storage/db'
import { useEditorStore, useProject } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'
import { SegmentedField, SelectField, SwitchField } from '../editor/fields'
import { importIntoProject } from '../editor/mediaImport'

type Source = 'generate' | 'imported' | 'designed'

const DESIGNED_STYLES: GeneratedStyle[] = ['aurora', 'bokeh', 'radial', 'waves', 'particles', 'linear', 'grid']

export interface PromptToVideoDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  initialPrompt?: string
  /** Opens AI tools on the Images tab (to download the image model). */
  onSetupModel(): void
}

/**
 * "Describe your video": prompt → shot plan → pictures (local AI, your photos,
 * or designed backgrounds) → cinematic 3D camera moves, film look and
 * atmosphere on the timeline. It builds moving shots from stills; it does not
 * synthesize frame-by-frame footage, and says so.
 */
export function PromptToVideoDialog({ open, onOpenChange, initialPrompt = '', onSetupModel }: PromptToVideoDialogProps) {
  const project = useProject()
  const assets = useEditorStore((s) => s.assets)
  const apply = useEditorStore((s) => s.apply)
  const depthModel = useDepthModel()
  const [prompt, setPrompt] = useState(initialPrompt)
  const [length, setLength] = useState('30')
  const [style, setStyle] = useState<VisualStyle>('cinematic')
  const [source, setSource] = useState<Source>('designed')
  const [cinematic, setCinematic] = useState(true)
  const [captions, setCaptions] = useState(false)
  const [music, setMusic] = useState('__none')
  const [imageModelReady, setImageModelReady] = useState<boolean | null>(null)
  const [webgpu, setWebgpu] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<number, Partial<PlannedShot>>>({})
  const [mode, setMode] = useState<'replace' | 'append'>(project.scenes.length ? 'append' : 'replace')
  const [progress, setProgress] = useState<{ done: number; total: number; detail: string } | null>(null)
  const cancelled = useRef(false)

  const pictures = useMemo(
    () => project.assetIds.map((id) => assets[id]?.meta).filter((m): m is AssetMeta => m?.kind === 'image'),
    [project.assetIds, assets],
  )
  const audios = useMemo(() => project.assetIds.map((id) => assets[id]?.meta).filter((m): m is AssetMeta => m?.kind === 'audio'), [project.assetIds, assets])

  useEffect(() => {
    if (!open) return
    let alive = true
    void useDepthModel.getState().check()
    void (async () => {
      const caps = await detectDeviceCapabilities()
      const ready = await isModelDownloaded(SD_TURBO)
      if (!alive) return
      setWebgpu(caps.webgpu.available && caps.webgpu.shaderF16 ? null : (caps.webgpu.reason ?? 'This GPU lacks shader-f16 support.'))
      setImageModelReady(ready)
      if (ready && caps.webgpu.available) setSource('generate')
      else if (pictures.length) setSource('imported')
    })()
    return () => {
      alive = false
    }
    // Re-check whenever the dialog opens.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [open])

  const plan = useMemo(() => (prompt.trim() ? planVideo(prompt, { length: Number(length), style }) : null), [prompt, length, style])
  const shots = useMemo(() => plan?.shots.map((s, i) => ({ ...s, ...edits[i] })) ?? [], [plan, edits])
  const running = progress !== null
  const canGenerate = imageModelReady === true && webgpu === null
  const depthReady = depthModel.status === 'ready'
  const usesPictures = source !== 'designed'

  const build = async () => {
    if (!plan || !shots.length) return
    cancelled.current = false
    const start = mode === 'append' ? project.scenes.length : 0
    const metas: (AssetMeta | undefined)[] = []
    try {
      // 1. Pictures for each shot.
      if (source === 'generate') {
        setProgress({ done: 0, total: shots.length, detail: 'Loading the image model onto the GPU…' })
        await imageGen.load()
        const baseSeed = hashString(plan.subject) % 1_000_000
        for (let i = 0; i < shots.length; i++) {
          if (cancelled.current) throw new Error('cancelled')
          setProgress({ done: i, total: shots.length, detail: `Generating picture ${i + 1} of ${shots.length}: ${shots[i]!.title}` })
          const { blob } = await imageGen.generate(shots[i]!.imagePrompt, baseSeed + i * 7)
          const file = new File([blob], `${plan.subject.slice(0, 32).replace(/[^\w-]+/g, '-')}-${i + 1}.png`, { type: 'image/png' })
          const [meta] = await importIntoProject([file], {
            origin: 'generated',
            generator: { model: `${SD_TURBO.name} (${SD_TURBO.revision.slice(0, 7)})`, prompt: shots[i]!.imagePrompt },
            quiet: true,
          })
          metas.push(meta)
        }
      } else if (source === 'imported') {
        shots.forEach((_, i) => metas.push(pictures[i % pictures.length]))
      }

      // 2. Depth for cinematic 3D motion (once per distinct picture).
      const depths = new Map<string, DepthAnalysis>()
      if (cinematic && usesPictures && depthReady) {
        const distinct = [...new Set(metas.filter((m): m is AssetMeta => !!m).map((m) => m.id))]
        for (let i = 0; i < distinct.length; i++) {
          if (cancelled.current) throw new Error('cancelled')
          setProgress({ done: i, total: distinct.length, detail: `Measuring depth ${i + 1} of ${distinct.length}…` })
          depths.set(distinct[i]!, await analyzeDepth(distinct[i]!))
          getPreviewEngine()?.refreshDepth(distinct[i]!)
        }
      }

      // 3. Shots: framing, camera, look, atmosphere.
      setProgress({ done: 1, total: 1, detail: 'Directing the shots…' })
      const { width, height } = outputDimensions(project.aspectRatio, '720p')
      const look = { ...lookForStyle(style, project.aspectRatio), atmosphere: atmosphereForPrompt(prompt) }
      const scenes: Scene[] = shots.map((shot, i) => {
        const meta = metas[i]
        const scene = createScene({ index: start + i, title: shot.title, notes: shot.imagePrompt, duration: shot.duration, asset: meta })
        const direction = directShot(shot.title, i)
        scene.look = { ...look }
        if (!meta) {
          scene.background = createGeneratedBackground(DESIGNED_STYLES[i % DESIGNED_STYLES.length]!, paletteFor(start + i + 3), hashString(scene.id))
        } else if (scene.background.kind === 'media') {
          const depth = depths.get(meta.id)
          const crop = framingCrop(direction.framing, depth?.subjectBox ?? null, meta.width ?? 512, meta.height ?? 512, width / height, i)
          if (crop) {
            scene.background.fit = 'crop'
            scene.background.crop = crop
          }
          if (cinematic && depth) {
            scene.cinematic = { ...defaultCinematic(), enabled: true, camera: direction.camera, intensity: 0.55, focus: direction.focus, foliage: true, haze: direction.haze }
          } else {
            scene.motion = { preset: i % 3 === 2 ? 'parallax' : 'kenBurns', intensity: 0.55, easing: 'easeInOut' }
          }
        }
        scene.transition = { type: i === 0 && start === 0 ? 'fadeBlack' : shot.transition === 'fadeBlack' ? 'crossfade' : shot.transition, duration: 0.5 }
        if (captions && shot.caption.trim()) {
          const overlay = createOverlay(shot.caption.trim(), i === 0 ? 'title' : 'caption', project.aspectRatio)
          scene.overlays.push({ ...overlay, animationIn: shot.captionAnimation, start: i === 0 ? 0.3 : 0.4 })
        }
        return scene
      })
      const musicMeta = audios.find((a) => a.id === music)
      apply(
        (d) => {
          applyStoryboard(d, scenes, mode)
          if (mode === 'replace' && d.name === 'Untitled project') d.name = plan.title
          if (musicMeta) d.audioTracks.push(createAudioTrack(musicMeta, 'music', mode === 'append' ? project.scenes.reduce((t, s) => t + s.duration, 0) : 0))
        },
        { select: { kind: 'scene', sceneId: scenes[0]!.id } },
      )
      // Land inside the first new shot (t = 0 is the black start of the fade-in).
      const firstStart = mode === 'append' ? project.scenes.reduce((t, s) => t + s.duration, 0) : 0
      usePlaybackStore.getState().seek(firstStart + Math.min(1, scenes[0]!.duration / 2))
      toast.success(`Created ${scenes.length} shots from your prompt`, {
        description: 'Press play to watch it, adjust any shot on the timeline, then Export.',
        action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() },
      })
      onOpenChange(false)
    } catch (error) {
      if (!cancelled.current) toast.error('Could not create the video', { description: errorMessage(error) })
      else toast.info(`Stopped. ${metas.length} generated picture${metas.length === 1 ? ' was' : 's were'} kept in the media bin.`)
    } finally {
      setProgress(null)
    }
  }

  const depthSize = depthModel.manifest?.files.reduce((n, f) => n + f.bytes, 0) ?? 0

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl" showCloseButton={!running} data-testid="prompt-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" /> Describe your video
          </DialogTitle>
          <DialogDescription>
            Type what the video should show. LocVid plans the shots, gets a picture for each, and films it with a virtual 3D camera, film look and
            atmosphere — all on this device.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0">
          <div className="grid gap-4 pr-2">
            <Textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setEdits({})
              }}
              placeholder="e.g. A boy playing football in a village field at sunset"
              rows={2}
              maxLength={300}
              className="text-base"
              autoFocus
              data-testid="prompt-input"
              disabled={running}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <SegmentedField<string>
                label="Length"
                value={length}
                options={[
                  { value: '15', label: '15 s' },
                  { value: '30', label: '30 s' },
                  { value: '60', label: '60 s' },
                ]}
                onChange={setLength}
              />
              <SelectField<VisualStyle>
                label="Look"
                value={style}
                options={(Object.keys(STYLE_LABELS) as VisualStyle[]).map((v) => ({ value: v, label: STYLE_LABELS[v] }))}
                onChange={setStyle}
              />
              <SelectField<string>
                label="Music"
                value={music}
                options={[{ value: '__none', label: audios.length ? 'None' : 'None (import audio first)' }, ...audios.map((a) => ({ value: a.id, label: a.name }))]}
                onChange={setMusic}
              />
            </div>

            <fieldset className="grid gap-2" disabled={running}>
              <legend className="mb-1 text-xs text-muted-foreground">Pictures for each shot</legend>
              <SourceOption
                active={source === 'generate'}
                disabled={!canGenerate}
                onSelect={() => setSource('generate')}
                title="Generate with AI on this device"
                badge={canGenerate ? 'SD-Turbo · ready' : imageModelReady === false ? 'Model not downloaded' : webgpu ? 'Not supported here' : 'Checking…'}
                description={
                  canGenerate
                    ? 'A new 512×512 picture for every shot, made on your GPU. Prompts never leave this device.'
                    : webgpu
                      ? `Needs WebGPU with half-precision support: ${webgpu}`
                      : 'Needs the optional SD-Turbo model (2.3 GB, one-time download).'
                }
                action={
                  imageModelReady === false && !webgpu ? (
                    <Button size="xs" variant="secondary" onClick={onSetupModel}>
                      Set up model
                    </Button>
                  ) : null
                }
                testId="source-generate"
              />
              <SourceOption
                active={source === 'imported'}
                disabled={pictures.length === 0}
                onSelect={() => setSource('imported')}
                title="Film my photos"
                badge={pictures.length ? `${pictures.length} photo${pictures.length === 1 ? '' : 's'}` : 'None imported'}
                description="Each shot frames your photos differently — wide, medium, close-up, detail — with its own camera move."
                testId="source-imported"
              />
              <SourceOption
                active={source === 'designed'}
                onSelect={() => setSource('designed')}
                title="Designed backgrounds (no pictures)"
                badge="Instant"
                description="Animated gradients and lights — best with captions on."
                testId="source-designed"
              />
            </fieldset>

            {usesPictures ? (
              <div className="grid gap-2 rounded-lg border p-2.5">
                <SwitchField
                  label="Cinematic 3D motion"
                  hint="The camera moves through each picture in depth, with parallax, depth of field and drifting sky."
                  checked={cinematic}
                  onChange={setCinematic}
                  testId="prompt-cinematic"
                />
                {cinematic && depthModel.status === 'absent' ? (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <Box className="size-3.5" /> Needs the depth model ({formatBytes(depthSize)}, Apache-2.0), downloaded once from huggingface.co.
                    <Button size="xs" variant="secondary" onClick={() => void depthModel.download()} data-testid="prompt-depth-download">
                      <Download /> Download
                    </Button>
                  </div>
                ) : null}
                {cinematic && depthModel.status === 'downloading' ? (
                  <div className="grid gap-1">
                    <Progress value={depthModel.total ? (depthModel.loaded / depthModel.total) * 100 : 0} />
                    <span className="text-[11px] text-muted-foreground tabular">
                      Downloading depth model · {formatBytes(depthModel.loaded)} of {formatBytes(depthModel.total)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
            <SwitchField label="Captions" hint="On-screen text for each shot (off = visuals only)." checked={captions} onChange={setCaptions} testId="prompt-captions" />

            {plan ? (
              <section className="grid gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Shot plan</span>
                  <Badge variant="outline" className="font-normal">
                    Rule-based
                  </Badge>
                  <span>
                    {shots.length} shots · {Math.round(shots.reduce((t, s) => t + s.duration, 0))} s
                  </span>
                </div>
                <ol className="grid gap-1.5" data-testid="prompt-shots">
                  {shots.map((shot, i) => {
                    const direction = directShot(shot.title, i)
                    return (
                      <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-md border p-2">
                        <span className="mt-1 text-xs font-semibold text-muted-foreground tabular">{i + 1}</span>
                        <div className="grid gap-1.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="font-medium">{shot.title}</span>
                            <Badge variant="secondary" className="font-normal">
                              {direction.framing} · {direction.camera.replace(/([A-Z])/g, ' $1').toLowerCase()}
                            </Badge>
                          </div>
                          {source === 'generate' ? (
                            <Input
                              aria-label={`Picture prompt for shot ${i + 1}`}
                              value={shot.imagePrompt}
                              disabled={running}
                              onChange={(e) => setEdits((x) => ({ ...x, [i]: { ...x[i], imagePrompt: e.target.value } }))}
                              className="h-7 text-xs text-muted-foreground"
                            />
                          ) : null}
                          {captions ? (
                            <Input
                              aria-label={`Caption for shot ${i + 1}`}
                              value={shot.caption}
                              disabled={running}
                              onChange={(e) => setEdits((x) => ({ ...x, [i]: { ...x[i], caption: e.target.value } }))}
                              className="h-7 text-sm"
                            />
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </section>
            ) : null}

            <p className="flex gap-2 rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Shots are filmed from still pictures by a virtual 3D camera — people and objects in them don't move on their own (no text-to-video model
              runs in a browser yet). The local image model draws generic scenes well but not specific characters; publishing copyrighted characters
              may need permission.
            </p>
          </div>
        </ScrollArea>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          {progress ? (
            <div className="grid flex-1 gap-1" data-testid="prompt-progress">
              <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
              <span className="text-xs text-muted-foreground">{progress.detail}</span>
            </div>
          ) : project.scenes.length > 0 ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Existing scenes:</span>
              <Button size="xs" variant={mode === 'append' ? 'secondary' : 'ghost'} onClick={() => setMode('append')}>
                Keep & add after
              </Button>
              <Button size="xs" variant={mode === 'replace' ? 'secondary' : 'ghost'} onClick={() => setMode('replace')}>
                Replace all
              </Button>
            </div>
          ) : (
            <span />
          )}
          {running ? (
            <Button
              variant="outline"
              onClick={() => {
                cancelled.current = true
              }}
            >
              <X /> Stop
            </Button>
          ) : (
            <Button
              onClick={() => void build()}
              disabled={!plan || (source === 'generate' && !canGenerate) || depthModel.status === 'downloading'}
              data-testid="prompt-create"
            >
              {source === 'generate' ? <Sparkles /> : <Wand2 />} Create video
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SourceOption({
  active,
  disabled,
  onSelect,
  title,
  badge,
  description,
  action,
  testId,
}: {
  active: boolean
  disabled?: boolean
  onSelect(): void
  title: string
  badge: string
  description: string
  action?: React.ReactNode
  testId?: string
}) {
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border p-2.5 transition', active ? 'border-primary bg-primary/10' : 'hover:bg-muted/40', disabled && 'opacity-60')}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        disabled={disabled}
        onClick={onSelect}
        className="flex flex-1 items-start gap-3 text-left disabled:cursor-not-allowed"
        data-testid={testId}
      >
        <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', active && 'border-primary')}>
          {active ? <span className="size-2 rounded-full bg-primary" /> : null}
        </span>
        <span className="grid gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {title}
            <Badge variant="secondary" className="font-normal">
              {badge}
            </Badge>
          </span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </span>
      </button>
      {action}
    </div>
  )
}
