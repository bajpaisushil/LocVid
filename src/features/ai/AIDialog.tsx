import { Cpu, ImagePlus, LayoutTemplate, Microscope, Plus, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { detectDeviceCapabilities, type DeviceCapabilities } from '@/ai/capabilities'
import { addScenes } from '@/core/operations'
import type { MotionPreset } from '@/core/types'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEditorStore, useProject } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'
import { SelectField, SliderField } from '../editor/fields'
import { importIntoProject } from '../editor/mediaImport'
import { MOTION_OPTIONS } from '../editor/props/shared'
import { ImageGenerationPanel } from './ImageGenerationPanel'
import { ModelsList } from './ModelsList'
import { SCENE_TEMPLATES } from './sceneTemplates'

type Tab = 'scenes' | 'motion' | 'images' | 'device'

export function AIDialog({
  open,
  onOpenChange,
  initialTab = 'scenes',
}: {
  open: boolean
  onOpenChange(open: boolean): void
  initialTab?: Tab
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[88vh] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-3xl" data-testid="ai-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> AI & generated scenes
          </DialogTitle>
          <DialogDescription>
            Everything here is optional and runs on this device. Designed scenes and motion need no model at all; local image generation only
            downloads a model when you ask for it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-lg bg-muted/40 p-1" role="tablist">
          {(
            [
              ['scenes', 'Designed scenes', LayoutTemplate],
              ['motion', 'Animate images', Wand2],
              ['images', 'Images', ImagePlus],
              ['device', 'Device check', Cpu],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition',
                tab === id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid={`ai-tab-${id}`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <ScrollArea className="min-h-0">
          <div className="pr-2">
            {tab === 'scenes' ? <TemplatesTab onDone={() => onOpenChange(false)} /> : null}
            {tab === 'motion' ? <MotionTab /> : null}
            {tab === 'images' ? <ImagesTab /> : null}
            {tab === 'device' ? <DeviceTab /> : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function TemplatesTab({ onDone }: { onDone(): void }) {
  const project = useProject()
  const apply = useEditorStore((s) => s.apply)
  const selection = useEditorStore((s) => s.selection)
  const [templateId, setTemplateId] = useState(SCENE_TEMPLATES[0]!.id)
  const [values, setValues] = useState<Record<string, string>>({})
  const template = SCENE_TEMPLATES.find((t) => t.id === templateId)!
  const selectedIndex =
    selection.kind === 'scene' || selection.kind === 'overlay' ? project.scenes.findIndex((s) => s.id === selection.sceneId) : -1
  const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : project.scenes.length

  const insert = () => {
    const scene = template.build(values, project.aspectRatio, insertAt)
    apply((d) => addScenes(d, [scene], insertAt), { select: { kind: 'scene', sceneId: scene.id } })
    const start = project.scenes.slice(0, insertAt).reduce((t, s) => t + s.duration, 0)
    usePlaybackStore.getState().seek(start + 0.4)
    toast.success(`Added a ${template.name.toLowerCase()} scene`)
    setValues({})
    onDone()
  }

  return (
    <div className="grid gap-4 py-1">
      <p className="text-xs text-muted-foreground">
        Level 1 generation: complete scenes built from procedural backgrounds, shapes and typography. Rendered identically in preview and export.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Scene template">
        {SCENE_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={t.id === templateId}
            onClick={() => {
              setTemplateId(t.id)
              setValues({})
            }}
            className={cn('rounded-lg border p-2 text-left transition', t.id === templateId ? 'border-primary bg-primary/10' : 'hover:bg-muted/50')}
            data-testid={`template-${t.id}`}
          >
            <div className="text-sm font-medium">{t.name}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t.description}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-3">
        {template.fields.map((f) => (
          <div key={f.key} className="grid gap-1.5">
            <Label htmlFor={`tpl-${f.key}`} className="text-xs text-muted-foreground">
              {f.label}
            </Label>
            {f.multiline ? (
              <Textarea
                id={`tpl-${f.key}`}
                rows={3}
                placeholder={f.placeholder}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            ) : (
              <Input
                id={`tpl-${f.key}`}
                placeholder={f.placeholder}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Inserts as scene {insertAt + 1}
          {selectedIndex >= 0 ? ' (after the selected scene)' : ' (at the end)'}
        </span>
        <Button onClick={insert} data-testid="insert-template">
          <Plus /> Insert scene
        </Button>
      </div>
    </div>
  )
}

function MotionTab() {
  const project = useProject()
  const assets = useEditorStore((s) => s.assets)
  const apply = useEditorStore((s) => s.apply)
  const [preset, setPreset] = useState<MotionPreset>('kenBurns')
  const [intensity, setIntensity] = useState(0.5)
  const imageScenes = project.scenes.filter((s) => s.background.kind === 'media' && assets[s.background.assetId]?.meta.kind === 'image')
  return (
    <div className="grid gap-4 py-1">
      <p className="text-xs text-muted-foreground">
        Level 1 animation: give every photo scene camera motion in one step — pan, zoom, Ken Burns drift, or a 2.5D parallax card (blurred backdrop
        moving faster than the photo). Each scene gets its own direction, chosen deterministically.
      </p>
      <SelectField<MotionPreset> label="Motion" value={preset} options={MOTION_OPTIONS} onChange={setPreset} />
      <SliderField label="Intensity" value={intensity} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={setIntensity} />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {imageScenes.length} photo scene{imageScenes.length === 1 ? '' : 's'} in this project
        </span>
        <Button
          disabled={imageScenes.length === 0}
          onClick={() => {
            const ids = new Set(imageScenes.map((s) => s.id))
            apply((d) => {
              for (const s of d.scenes) if (ids.has(s.id)) s.motion = { ...s.motion, preset, intensity }
            })
            toast.success(`Applied motion to ${ids.size} scene${ids.size === 1 ? '' : 's'}`, {
              action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() },
            })
          }}
          data-testid="apply-motion-all"
        >
          <Wand2 /> Apply to all photos
        </Button>
      </div>
    </div>
  )
}

function ImagesTab() {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="grid gap-5 py-1">
      <section className="grid gap-2 rounded-lg border p-3">
        <h3 className="text-sm font-medium">Import images made elsewhere</h3>
        <p className="text-xs text-muted-foreground">
          Generated an image with another tool? Import it like any photo — it is stored locally with your other media.
        </p>
        <div>
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>
            <ImagePlus /> Import generated images
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              void importIntoProject(files, { origin: 'generated' })
            }}
          />
        </div>
      </section>
      <ImageGenerationPanel />
      <section className="grid gap-2 rounded-lg border border-dashed p-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Microscope className="size-4" /> Text-to-video in the browser
          <Badge variant="outline" className="font-normal">
            Researched · not available
          </Badge>
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Today's open-weight video models (e.g. Wan 2.x, LTX-Video, CogVideoX, HunyuanVideo) are PyTorch/CUDA models that need roughly 8–24 GB of
          GPU memory plus multi-gigabyte text encoders, and have no maintained WebGPU/ONNX browser runtime. They can't run reliably in a browser tab,
          so LocVid doesn't pretend to offer it. The editor has an adapter point for a future in-browser model; see the README.
        </p>
      </section>
    </div>
  )
}

function DeviceTab() {
  const [caps, setCaps] = useState<DeviceCapabilities | null>(null)
  useEffect(() => {
    void detectDeviceCapabilities().then(setCaps)
  }, [])
  if (!caps) return <p className="py-4 text-sm text-muted-foreground">Checking this device…</p>
  const rows: [string, string, boolean | null][] = [
    ['WebGPU', caps.webgpu.available ? `Yes${caps.webgpu.description || caps.webgpu.vendor ? ` — ${caps.webgpu.description || caps.webgpu.vendor}` : ''}` : `No — ${caps.webgpu.reason}`, caps.webgpu.available],
    ['GPU half precision (shader-f16)', caps.webgpu.shaderF16 ? 'Yes' : 'No', caps.webgpu.shaderF16],
    ['Largest GPU buffer', caps.webgpu.available ? formatBytes(caps.webgpu.maxBufferSize) : '—', null],
    ['WebAssembly SIMD', caps.wasmSimd ? 'Yes' : 'No', caps.wasmSimd],
    ['WebAssembly threads', caps.wasmThreads ? 'Yes' : 'No (page is not cross-origin isolated)', caps.wasmThreads],
    ['Memory (reported)', caps.deviceMemory ? `~${caps.deviceMemory} GB` : 'Not reported by this browser', null],
    ['CPU threads', String(caps.cores), null],
    ['Storage available to this site', caps.storageQuota ? `~${formatBytes(caps.storageQuota - (caps.storageUsage ?? 0))}` : 'Unknown', null],
  ]
  return (
    <div className="grid gap-3 py-1">
      <dl className="divide-y rounded-lg border text-sm" data-testid="device-report">
        {rows.map(([label, value, ok]) => (
          <div key={label} className="flex items-start justify-between gap-4 px-3 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn('text-right', ok === true && 'text-emerald-400', ok === false && 'text-muted-foreground')}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        The editor and MP4 export never need these. Local image generation needs WebGPU; without it, use designed scenes or import images.
      </p>
      <ModelsList />
    </div>
  )
}
