import { CheckCircle2, ExternalLink, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { confirm } from '@/components/dialog-api'
import { Button } from '@/components/ui/button'
import { imageGen } from '@/ai/imagegen/client'
import { deleteModel, isModelDownloaded } from '@/ai/modelStore'
import { CUTOUT_MODEL, DEPTH_CPU, DEPTH_GPU, INPAINT_MODEL, modelBytes, SD_TURBO, UPSCALE_MODEL, type ModelManifest } from '@/ai/models'
import { stopDepthWorker } from '@/ai/vision/depth'
import { errorMessage } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { useCutoutModels } from './cutoutModelStore'
import { useDepthModel } from './depthModelStore'
import { useUpscaleModel } from './upscaleModelStore'

const MODELS: { model: ModelManifest; use: string }[] = [
  { model: DEPTH_GPU, use: 'Cinematic 3D motion (GPU)' },
  { model: DEPTH_CPU, use: 'Cinematic 3D motion (CPU)' },
  { model: CUTOUT_MODEL, use: 'Subject cut-out' },
  { model: INPAINT_MODEL, use: 'Background behind the subject' },
  { model: UPSCALE_MODEL, use: 'Sharper generated pictures' },
  { model: SD_TURBO, use: 'Picture generation' },
]

async function downloadedModels(): Promise<Record<string, boolean>> {
  const entries = await Promise.all(MODELS.map(async ({ model }) => [model.id, await isModelDownloaded(model)] as const))
  return Object.fromEntries(entries)
}

/** Every optional on-device model: what it's for, its size and license, and whether it's stored here. */
export function ModelsList() {
  const [present, setPresent] = useState<Record<string, boolean> | null>(null)
  const refresh = useCallback(() => void downloadedModels().then(setPresent), [])
  useEffect(() => {
    void downloadedModels().then(setPresent)
  }, [])

  const remove = async (model: ModelManifest) => {
    const ok = await confirm({
      title: `Delete ${model.name}?`,
      description: `Frees ${formatBytes(modelBytes(model))} of browser storage. Your projects keep their already-computed results; you can download the model again any time.`,
      confirmLabel: 'Delete model',
      destructive: true,
    })
    if (!ok) return
    try {
      // Release it from memory first: a loaded session keeps its own copy.
      if (model === SD_TURBO) imageGen.terminate()
      else stopDepthWorker()
      await deleteModel(model)
      await Promise.all([useDepthModel.getState().check(), useCutoutModels.getState().check(), useUpscaleModel.getState().check()])
      toast.success(`${model.name} deleted`)
    } catch (error) {
      toast.error('Could not delete the model', { description: errorMessage(error) })
    }
    refresh()
  }

  return (
    <section className="grid gap-2" aria-label="On-device models">
      <h3 className="text-sm font-medium">On-device models</h3>
      <ul className="divide-y rounded-lg border text-sm" data-testid="models-list">
        {MODELS.map(({ model, use }) => {
          const here = present?.[model.id]
          return (
            <li key={model.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid={`model-${model.id}`}>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">
                  {model.name} <span className="font-normal text-muted-foreground">· {use}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatBytes(modelBytes(model))} ·{' '}
                  <a href={model.license.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                    {model.license.name} <ExternalLink className="size-3" />
                  </a>
                </span>
              </div>
              {here ? (
                <>
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                    <CheckCircle2 className="size-3.5" /> Downloaded
                  </span>
                  <Button size="xs" variant="ghost" className="text-destructive" onClick={() => void remove(model)} aria-label={`Delete ${model.name}`}>
                    <Trash2 /> Delete
                  </Button>
                </>
              ) : (
                <span className="text-[11px] text-muted-foreground">{present ? 'Not downloaded' : 'Checking…'}</span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Models are downloaded only when you ask, from huggingface.co, and stay in this browser's storage. Nothing you make is ever uploaded.
      </p>
    </section>
  )
}
