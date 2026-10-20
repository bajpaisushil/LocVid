import { CheckCircle2, Download, Dices, ExternalLink, ImagePlus, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { confirm } from '@/components/dialog-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { detectDeviceCapabilities, type DeviceCapabilities } from '@/ai/capabilities'
import { imageGen } from '@/ai/imagegen/client'
import { deleteModel, downloadModel, isModelDownloaded, remainingBytes, type DownloadProgress } from '@/ai/imagegen/modelStore'
import { modelBytes, SD_TURBO } from '@/ai/imagegen/models'
import { createScene } from '@/core/defaults'
import { addScenes } from '@/core/operations'
import { errorMessage, isAbortError } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { useEditorStore } from '@/state/editorStore'
import { importIntoProject } from '../editor/mediaImport'

type ModelState =
  | { kind: 'checking' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'absent'; remaining: number }
  | { kind: 'downloading'; progress: DownloadProgress; startedAt: number; startLoaded: number; rate: number }
  | { kind: 'present' }

interface Result {
  url: string
  blob: Blob
  prompt: string
  seed: number
  ms: number
}

const model = SD_TURBO

function compatibility(caps: DeviceCapabilities): string | null {
  if (!caps.webgpu.available) return caps.webgpu.reason ?? 'WebGPU is not available.'
  if (model.requirements.shaderF16 && !caps.webgpu.shaderF16) return 'This GPU does not support half-precision shaders (shader-f16), which this model needs.'
  if (caps.webgpu.maxBufferSize < 1.8e9) return 'The GPU reports a maximum buffer size too small for this model (needs ~1.8 GB).'
  return null
}

/**
 * Level 2: optional local text-to-image. Nothing is downloaded until the
 * user accepts the license and clicks Download; prompts never leave the device.
 */
export function ImageGenerationPanel() {
  const [state, setState] = useState<ModelState>({ kind: 'checking' })
  const [accepted, setAccepted] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6))
  const [busy, setBusy] = useState<string | null>(null)
  const [loadProgress, setLoadProgress] = useState<{ detail: string; fraction: number } | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const download = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const caps = await detectDeviceCapabilities()
      const problem = compatibility(caps)
      if (cancelled) return
      if (problem) return setState({ kind: 'unsupported', reason: problem })
      setState((await isModelDownloaded(model)) ? { kind: 'present' } : { kind: 'absent', remaining: await remainingBytes(model) })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => imageGen.onProgress((detail, fraction) => setLoadProgress({ detail, fraction })), [])
  useEffect(() => () => results.forEach((r) => URL.revokeObjectURL(r.url)), [results])

  const startDownload = async () => {
    const ac = new AbortController()
    download.current = ac
    const startLoaded = modelBytes(model) - (state.kind === 'absent' ? state.remaining : modelBytes(model))
    const startedAt = performance.now()
    setState({ kind: 'downloading', progress: { loaded: startLoaded, total: modelBytes(model), file: '' }, startedAt, startLoaded, rate: 0 })
    try {
      await downloadModel(
        model,
        (progress) => {
          const rate = (progress.loaded - startLoaded) / Math.max(0.5, (performance.now() - startedAt) / 1000)
          setState((s) => (s.kind === 'downloading' ? { ...s, progress, rate } : s))
        },
        ac.signal,
      )
      setState({ kind: 'present' })
      toast.success('Model downloaded and stored in this browser')
    } catch (error) {
      setState({ kind: 'absent', remaining: await remainingBytes(model) })
      if (!isAbortError(error)) toast.error('Download failed', { description: errorMessage(error) })
    } finally {
      download.current = null
    }
  }

  const generate = async () => {
    const text = prompt.trim()
    if (!text) return
    try {
      if (!imageGen.loaded) {
        setBusy('Loading the model onto the GPU…')
        await imageGen.load()
      }
      setBusy('Generating…')
      const { blob, ms } = await imageGen.generate(text, seed)
      setResults((r) => [{ url: URL.createObjectURL(blob), blob, prompt: text, seed, ms }, ...r].slice(0, 8))
      setSeed(Math.floor(Math.random() * 1e6))
    } catch (error) {
      toast.error('Image generation failed', { description: errorMessage(error) })
      imageGen.terminate()
    } finally {
      setBusy(null)
      setLoadProgress(null)
    }
  }

  const addToProject = async (r: Result, asScene: boolean) => {
    const file = new File([r.blob], `generated-${r.seed}.png`, { type: 'image/png' })
    const [meta] = await importIntoProject([file], {
      origin: 'generated',
      generator: { model: `${model.name} (${model.revision.slice(0, 7)})`, prompt: r.prompt },
      quiet: true,
    })
    const project = useEditorStore.getState().project
    if (!meta || !project) {
      toast.error('Could not add the image')
      return
    }
    if (asScene) {
      const scene = createScene({ index: project.scenes.length, asset: meta, title: r.prompt.slice(0, 40) })
      scene.background = { ...scene.background, fit: 'contain', fill: 'blur' } as typeof scene.background
      useEditorStore.getState().apply((d) => addScenes(d, [scene]), { select: { kind: 'scene', sceneId: scene.id } })
    }
    toast.success(asScene ? 'Added as a new scene' : 'Added to the media bin')
  }

  const removeModel = async () => {
    const ok = await confirm({
      title: 'Delete the downloaded model?',
      description: `This frees about ${formatBytes(modelBytes(model))} of browser storage. You can download it again later.`,
      confirmLabel: 'Delete model',
      destructive: true,
    })
    if (!ok) return
    imageGen.terminate()
    await deleteModel(model)
    setState({ kind: 'absent', remaining: modelBytes(model) })
  }

  return (
    <section className="grid gap-3 rounded-lg border p-3" data-testid="imagegen-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" /> Generate images locally — {model.name}
        </h3>
        <Badge variant="outline" className="font-normal">
          Optional · {formatBytes(modelBytes(model))} download
        </Badge>
        {state.kind === 'present' ? (
          <Badge variant="secondary" className="font-normal text-emerald-400">
            <CheckCircle2 /> Downloaded
          </Badge>
        ) : null}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {model.description} Runs on your GPU with WebGPU (ONNX Runtime Web). {model.speed} Your prompts and images never leave this device; the
        only network traffic is downloading the model files from huggingface.co.
      </p>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="inline text-muted-foreground">Needs: </dt>
          <dd className="inline">WebGPU with shader-f16, ~{model.requirements.gpuMemoryGB} GB GPU memory, {model.requirements.ramGB} GB+ RAM</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Output: </dt>
          <dd className="inline">
            {model.output.width}×{model.output.height} (square — use “Contain” or parallax in 16:9/9:16)
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline text-muted-foreground">License: </dt>
          <dd className="inline">
            <a href={model.license.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline underline-offset-2">
              {model.license.name} <ExternalLink className="size-3" />
            </a>{' '}
            — {model.license.summary}
          </dd>
        </div>
      </dl>

      {state.kind === 'checking' ? <p className="text-xs text-muted-foreground">Checking this device…</p> : null}

      {state.kind === 'unsupported' ? (
        <p className="rounded-md bg-muted/50 p-2 text-xs" data-testid="imagegen-unsupported">
          Not available on this device: {state.reason} You can still use designed scenes, or import images generated elsewhere.
        </p>
      ) : null}

      {state.kind === 'absent' ? (
        <div className="grid gap-2">
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="imagegen-accept" />
            <span>
              I have read the {model.license.name} and accept it for my use. Downloads {formatBytes(state.remaining)} from huggingface.co into this
              browser's storage.
            </span>
          </label>
          <div>
            <Button size="sm" disabled={!accepted} onClick={() => void startDownload()} data-testid="imagegen-download">
              <Download /> Download model ({formatBytes(state.remaining)})
            </Button>
          </div>
        </div>
      ) : null}

      {state.kind === 'downloading' ? (
        <DownloadProgressView state={state} onCancel={() => download.current?.abort()} />
      ) : null}

      {state.kind === 'present' ? (
        <div className="grid gap-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="A misty pine forest at sunrise, cinematic lighting"
            data-testid="imagegen-prompt"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate()
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Seed
              <Input
                type="number"
                className="h-7 w-28 text-xs tabular"
                value={seed}
                onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                aria-label="Seed"
              />
            </label>
            <Button variant="ghost" size="icon-sm" aria-label="Random seed" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>
              <Dices />
            </Button>
            <Button size="sm" onClick={() => void generate()} disabled={!prompt.trim() || busy !== null} data-testid="imagegen-generate">
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ?? 'Generate'}
            </Button>
            {imageGen.loaded && !busy ? (
              <Button variant="ghost" size="sm" onClick={() => imageGen.terminate()}>
                Unload from GPU
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => void removeModel()}>
              <Trash2 /> Delete model
            </Button>
          </div>
          {busy && loadProgress && loadProgress.fraction < 1 ? (
            <div className="grid gap-1">
              <Progress value={loadProgress.fraction * 100} />
              <span className="text-[11px] text-muted-foreground">{loadProgress.detail}</span>
            </div>
          ) : null}
          {results.length ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="imagegen-results">
              {results.map((r) => (
                <li key={r.url} className="grid gap-1">
                  <img src={r.url} alt={r.prompt} className="aspect-square w-full rounded-md object-cover" />
                  <span className="truncate text-[10px] text-muted-foreground" title={`${r.prompt} · seed ${r.seed}`}>
                    {(r.ms / 1000).toFixed(1)} s · seed {r.seed}
                  </span>
                  <div className="flex gap-1">
                    <Button size="xs" variant="secondary" className="flex-1" onClick={() => void addToProject(r, false)}>
                      <ImagePlus /> Media
                    </Button>
                    <Button size="xs" variant="secondary" className="flex-1" onClick={() => void addToProject(r, true)}>
                      <Plus /> Scene
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function DownloadProgressView({ state, onCancel }: { state: Extract<ModelState, { kind: 'downloading' }>; onCancel(): void }) {
  const { loaded, total, file } = state.progress
  const { rate } = state
  const eta = rate > 0 ? (total - loaded) / rate : null
  return (
    <div className="grid gap-1.5" data-testid="imagegen-downloading">
      <Progress value={(loaded / total) * 100} aria-label="Model download progress" />
      <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground tabular">
        <span>
          {formatBytes(loaded)} of {formatBytes(total)}
        </span>
        {rate > 0 ? <span>{formatBytes(rate)}/s</span> : null}
        {eta !== null ? <span>~{Math.ceil(eta / 60)} min left</span> : null}
        {file ? <span className="truncate">{file}</span> : null}
        <Button size="xs" variant="ghost" className="ml-auto" onClick={onCancel}>
          <X /> Cancel
        </Button>
      </div>
      <span className="text-[11px] text-muted-foreground">Finished files are kept, so a cancelled or interrupted download resumes where it stopped.</span>
    </div>
  )
}
