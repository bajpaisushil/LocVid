import { AlertTriangle, CheckCircle2, Cpu, Download, Film, Loader2, RotateCcw, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { confirm } from '@/components/dialog-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { outputDimensions } from '@/core/defaults'
import type { ResolutionPreset } from '@/core/types'
import { downloadBlob } from '@/lib/download'
import { formatBytes, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { detectExportCapabilities, type ExportCapabilities } from '@/export/capabilities'
import { exportProject, exportSettingsFor, preflight, type Preflight } from '@/export/exporter'
import { FFMPEG_CORE_SIZE_MB, isFFmpegLoaded } from '@/export/ffmpeg'
import { ExportError, type EnginePreference, type ExportProgress, type ExportResult } from '@/export/types'
import { useEditorStore, useProject } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'

type Phase =
  | { kind: 'setup' }
  | { kind: 'running'; progress: ExportProgress; startedAt: number }
  | { kind: 'done'; result: ExportResult; url: string }
  | { kind: 'error'; error: ExportError }

const STAGE_LABEL: Record<ExportProgress['stage'], string> = {
  preparing: 'Preparing',
  'loading-ffmpeg': `Loading FFmpeg.wasm (~${FFMPEG_CORE_SIZE_MB} MB, first time only)`,
  audio: 'Mixing audio',
  video: 'Rendering & encoding video',
  finalizing: 'Finalizing MP4',
}

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const project = useProject()
  const apply = useEditorStore((s) => s.apply)
  const [engine, setEngine] = useState<EnginePreference>('auto')
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' })
  const [caps, setCaps] = useState<ExportCapabilities | null>(null)
  const [check, setCheck] = useState<Preflight | null>(null)
  const controller = useRef<AbortController | null>(null)
  const settings = exportSettingsFor(project, engine)

  // Capabilities and preflight are re-evaluated whenever the dialog opens or settings change.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setCaps(null)
    void detectExportCapabilities(settings.width, settings.height, settings.fps, settings.videoBitrate).then((c) => !cancelled && setCaps(c))
    void preflight(project, settings).then((p) => !cancelled && setCheck(p))
    return () => {
      cancelled = true
    }
    // Recompute on dimension/fps changes; `settings` itself is a fresh object every render.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [open, project, settings.width, settings.height, settings.fps])

  // Release the result's object URL when the dialog moves on.
  useEffect(() => {
    if (phase.kind !== 'done') return
    const url = phase.url
    return () => URL.revokeObjectURL(url)
  }, [phase])

  const running = phase.kind === 'running'

  const start = async () => {
    usePlaybackStore.getState().pause()
    const ac = new AbortController()
    controller.current = ac
    const startedAt = performance.now()
    setPhase({ kind: 'running', progress: { stage: 'preparing', progress: 0 }, startedAt })
    try {
      const result = await exportProject(project, engine, { onProgress: (progress) => setPhase({ kind: 'running', progress, startedAt }) }, ac.signal)
      const url = URL.createObjectURL(result.blob)
      setPhase({ kind: 'done', result, url })
      downloadBlob(result.blob, result.fileName)
    } catch (error) {
      const e = error instanceof ExportError ? error : new ExportError('unknown', String(error))
      setPhase(e.code === 'cancelled' ? { kind: 'setup' } : { kind: 'error', error: e })
    } finally {
      controller.current = null
    }
  }

  const cancel = () => controller.current?.abort()

  const requestClose = async (next: boolean) => {
    if (next) return onOpenChange(true)
    if (running) {
      const ok = await confirm({
        title: 'Cancel the export?',
        description: 'Rendering will stop and nothing will be saved.',
        confirmLabel: 'Cancel export',
        cancelLabel: 'Keep exporting',
        destructive: true,
      })
      if (!ok) return
      cancel()
    }
    if (phase.kind !== 'running') setPhase({ kind: 'setup' })
    onOpenChange(false)
  }

  const setResolution = (resolution: ResolutionPreset) => apply((d) => void (d.output.resolution = resolution))
  const dims1080 = outputDimensions(project.aspectRatio, '1080p')
  const webcodecsOk = caps?.h264 ?? false
  const resolvedEngine = engine === 'auto' ? (caps ? (caps.h264 ? 'webcodecs' : 'ffmpeg') : null) : engine
  const blocking = check?.problems ?? []

  return (
    <Dialog open={open} onOpenChange={(o) => void requestClose(o)}>
      <DialogContent className="sm:max-w-xl" showCloseButton={!running} data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle>Export video</DialogTitle>
          <DialogDescription>Rendered on this device into an MP4 (H.264 + AAC). Nothing is uploaded.</DialogDescription>
        </DialogHeader>

        {phase.kind === 'setup' ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Resolution">
              {(['720p', '1080p'] as const).map((r) => {
                const d = outputDimensions(project.aspectRatio, r)
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={project.output.resolution === r}
                    onClick={() => setResolution(r)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition',
                      project.output.resolution === r ? 'border-primary bg-primary/10' : 'hover:bg-muted/50',
                    )}
                    data-testid={`resolution-${r}`}
                  >
                    <div className="text-sm font-medium">
                      {r} {r === '720p' ? <Badge variant="secondary" className="ml-1 font-normal">Recommended</Badge> : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {d.width}×{d.height} · {r === '720p' ? 'fastest, works on most devices' : '~2× slower, needs more memory'}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">Engine</span>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Export engine">
                <EngineOption
                  active={engine === 'auto'}
                  onSelect={() => setEngine('auto')}
                  title="Automatic"
                  description={caps ? `Uses ${caps.h264 ? 'the fast engine' : 'compatibility mode'} here` : 'Checking this browser…'}
                  testId="engine-auto"
                />
                <EngineOption
                  active={engine === 'webcodecs'}
                  onSelect={() => setEngine('webcodecs')}
                  title="Fast"
                  icon={<Zap className="size-3.5" />}
                  description={caps ? (webcodecsOk ? 'Browser hardware encoder (WebCodecs)' : 'Not supported in this browser') : '…'}
                  disabled={caps !== null && !webcodecsOk}
                  testId="engine-webcodecs"
                />
                <EngineOption
                  active={engine === 'ffmpeg'}
                  onSelect={() => setEngine('ffmpeg')}
                  title="Compatibility"
                  icon={<Cpu className="size-3.5" />}
                  description={`FFmpeg.wasm software encoder. Slower; ${isFFmpegLoaded() ? 'already loaded' : `downloads ~${FFMPEG_CORE_SIZE_MB} MB once`}`}
                  testId="engine-ffmpeg"
                />
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-4">
              <Stat label="Length" value={check ? formatTime(check.duration) : '…'} />
              <Stat label="Frames" value={check ? `${check.frames} @ ${settings.fps} fps` : '…'} />
              <Stat label="Size (at most)" value={check ? `~${formatBytes(check.estimatedBytes)}` : '…'} />
              <Stat
                label="Audio"
                value={caps ? (resolvedEngine === 'webcodecs' && !caps.aac ? 'AAC via FFmpeg' : 'AAC') : '…'}
              />
            </dl>

            {blocking.length ? (
              <Notice tone="error" testId="export-problems">
                {blocking.map((p) => (
                  <p key={p.message}>{p.message}</p>
                ))}
              </Notice>
            ) : null}
            {check?.warnings.length ? (
              <Notice tone="warning">
                {check.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </Notice>
            ) : null}
            {project.output.resolution === '1080p' && caps?.deviceMemory !== null && caps?.deviceMemory !== undefined && caps.deviceMemory <= 4 ? (
              <Notice tone="warning">
                This device reports about {caps.deviceMemory} GB of memory. 1080p ({dims1080.width}×{dims1080.height}) exports may fail; 720p is safer.
              </Notice>
            ) : null}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Keep this tab open while exporting. Typical speed with the fast engine is faster than real time on a recent laptop; the compatibility
              engine can be several times slower than the video's length.
            </p>
          </div>
        ) : null}

        {phase.kind === 'running' ? <RunningView progress={phase.progress} startedAt={phase.startedAt} /> : null}

        {phase.kind === 'done' ? (
          <div className="grid gap-3" data-testid="export-done">
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 className="size-4" /> Your video is ready — the download should start automatically.
            </div>
            <video src={phase.url} controls className="max-h-64 w-full rounded-lg bg-black" data-testid="export-preview" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-3">
              <Stat label="File" value={formatBytes(phase.result.blob.size)} />
              <Stat label="Resolution" value={`${phase.result.width}×${phase.result.height}`} />
              <Stat label="Length" value={formatTime(phase.result.duration)} />
              <Stat label="Video" value={phase.result.videoCodec} />
              <Stat label="Audio" value={phase.result.audioCodec ?? 'none'} />
              <Stat
                label="Took"
                value={`${formatTime(phase.result.elapsedMs / 1000, false)} · ${phase.result.engine === 'webcodecs' ? 'WebCodecs' : 'FFmpeg.wasm'}${phase.result.renderedIn === 'worker' ? ' in a worker' : ''}`}
              />
            </dl>
            {phase.result.warnings.length ? (
              <Notice tone="warning">
                {phase.result.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </Notice>
            ) : null}
          </div>
        ) : null}

        {phase.kind === 'error' ? (
          <Notice tone="error" testId="export-error">
            <p className="font-medium">{phase.error.message}</p>
            {phase.error.suggestion ? <p className="mt-1 opacity-90">{phase.error.suggestion}</p> : null}
          </Notice>
        ) : null}

        <DialogFooter>
          {phase.kind === 'setup' ? (
            <>
              <Button variant="outline" onClick={() => void requestClose(false)}>
                Close
              </Button>
              <Button onClick={() => void start()} disabled={!check || blocking.length > 0 || !caps} data-testid="start-export">
                <Film /> Export MP4
              </Button>
            </>
          ) : null}
          {phase.kind === 'running' ? (
            <Button variant="outline" onClick={cancel} data-testid="cancel-export">
              <X /> Cancel
            </Button>
          ) : null}
          {phase.kind === 'done' ? (
            <>
              <Button variant="outline" onClick={() => setPhase({ kind: 'setup' })}>
                <RotateCcw /> Export again
              </Button>
              <Button onClick={() => downloadBlob(phase.result.blob, phase.result.fileName)} data-testid="download-export">
                <Download /> Download {phase.result.fileName}
              </Button>
            </>
          ) : null}
          {phase.kind === 'error' ? (
            <>
              <Button variant="outline" onClick={() => setPhase({ kind: 'setup' })}>
                Change settings
              </Button>
              <Button onClick={() => void start()}>
                <RotateCcw /> Try again
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RunningView({ progress, startedAt }: { progress: ExportProgress; startedAt: number }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 500)
    return () => clearInterval(id)
  }, [])
  const pct = Math.round(progress.progress * 100)
  return (
    <div className="grid gap-3" data-testid="export-running">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="font-medium">{STAGE_LABEL[progress.stage]}</span>
        <span className="ml-auto text-muted-foreground tabular" data-testid="export-percent">
          {pct}%
        </span>
      </div>
      <Progress value={pct} aria-label="Export progress" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular">
        {progress.frame !== undefined && progress.totalFrames ? (
          <span>
            Frame {progress.frame} / {progress.totalFrames}
          </span>
        ) : null}
        <span>Elapsed {formatTime((now - startedAt) / 1000, false)}</span>
        {progress.eta !== undefined && Number.isFinite(progress.eta) ? <span>About {formatTime(progress.eta, false)} left</span> : null}
        {progress.speed ? <span>{progress.speed.toFixed(1)}× real time</span> : null}
      </div>
      {progress.detail ? <p className="text-xs text-muted-foreground">{progress.detail}</p> : null}
    </div>
  )
}

function EngineOption({
  active,
  onSelect,
  title,
  description,
  icon,
  disabled,
  testId,
}: {
  active: boolean
  onSelect(): void
  title: string
  description: string
  icon?: React.ReactNode
  disabled?: boolean
  testId?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'rounded-lg border p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-primary bg-primary/10' : 'hover:bg-muted/50',
      )}
      data-testid={testId}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{description}</div>
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular" title={value}>
        {value}
      </dd>
    </div>
  )
}

function Notice({ tone, children, testId }: { tone: 'error' | 'warning'; children: React.ReactNode; testId?: string }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex gap-2 rounded-lg border p-3 text-xs',
        tone === 'error' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-warning/30 bg-warning/10 text-warning',
      )}
      data-testid={testId}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="grid gap-1">{children}</div>
    </div>
  )
}
