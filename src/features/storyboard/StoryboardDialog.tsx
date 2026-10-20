import { Info, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { createGeneratedBackground, createOverlay, createScene, paletteFor } from '@/core/defaults'
import { applyStoryboard } from '@/core/operations'
import { listAssistants } from '@/core/storyboard/assistants'
import { DEFAULT_STORYBOARD_OPTIONS, type DraftScene, type StoryboardDraft, type StoryboardOptions } from '@/core/storyboard/types'
import { MAX_PROJECT_DURATION } from '@/core/types'
import { hashString } from '@/lib/id'
import { formatTime } from '@/lib/format'
import { errorMessage } from '@/lib/errors'
import { useEditorStore, useProject } from '@/state/editorStore'
import { usePlaybackStore } from '@/state/playbackStore'
import { SegmentedField, SelectField, SliderField, SwitchField } from '../editor/fields'

const EXAMPLE = `# Morning on the coast
The sun comes up over a quiet beach. The tide is out.

# Into the hills
We take the trail up the mountain and stop at a lake.

# Back to the city
By evening the city lights come on. What a day.`

export function StoryboardDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const project = useProject()
  const assets = useEditorStore((s) => s.assets)
  const apply = useEditorStore((s) => s.apply)
  const [text, setText] = useState('')
  const [options, setOptions] = useState<StoryboardOptions>(DEFAULT_STORYBOARD_OPTIONS)
  const [assistantId, setAssistantId] = useState('rules')
  const [draft, setDraft] = useState<StoryboardDraft | null>(null)
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const assistants = listAssistants()

  const images = useMemo(
    () =>
      project.assetIds
        .map((id) => assets[id]?.meta)
        .filter((m): m is NonNullable<typeof m> => !!m && m.kind !== 'audio')
        .map((m) => ({ id: m.id, name: m.name })),
    [project.assetIds, assets],
  )

  // Rebuild the draft as the script or options change (rules are instant).
  useEffect(() => {
    if (!open) return
    const assistant = assistants.find((a) => a.id === assistantId) ?? assistants[0]!
    const controller = new AbortController()
    const timer = setTimeout(() => {
      assistant
        .generate({ text, options, images }, controller.signal)
        .then((d) => !controller.signal.aborted && setDraft(d))
        .catch((error: unknown) => !controller.signal.aborted && toast.error('Storyboard failed', { description: errorMessage(error) }))
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // `assistants` is a fresh array each render; the id is what matters.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [open, text, options, images, assistantId])

  const editScene = (i: number, patch: Partial<DraftScene>) =>
    setDraft((d) => (d ? { ...d, scenes: d.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d))
  const removeScene = (i: number) => setDraft((d) => (d ? { ...d, scenes: d.scenes.filter((_, j) => j !== i) } : d))

  const scenes = draft?.scenes ?? []
  const total = scenes.reduce((sum, s) => sum + s.duration, 0)
  const existing = mode === 'append' ? project.scenes.reduce((sum, s) => sum + s.duration, 0) : 0
  const over = total + existing > MAX_PROJECT_DURATION

  const create = () => {
    if (!scenes.length) return
    const start = mode === 'append' ? project.scenes.length : 0
    const built = scenes.map((d, i) => {
      const meta = d.imageId ? assets[d.imageId]?.meta : undefined
      const scene = createScene({ index: start + i, title: d.title, notes: d.narration, duration: d.duration, asset: meta })
      if (!meta && d.isTitleCard) scene.background = createGeneratedBackground('aurora', paletteFor(start + i + 4), hashString(scene.id))
      if (d.caption.trim()) scene.overlays.push(createOverlay(d.caption.trim(), d.isTitleCard ? 'title' : 'caption', project.aspectRatio))
      return scene
    })
    apply((p) => applyStoryboard(p, built, mode), { select: { kind: 'scene', sceneId: built[0]!.id } })
    usePlaybackStore.getState().seek(mode === 'append' ? existing + 0.05 : 0)
    toast.success(`Added ${built.length} scene${built.length === 1 ? '' : 's'} from your script`, {
      action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() },
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-5xl" data-testid="storyboard-dialog">
        <DialogHeader>
          <DialogTitle>Script to storyboard</DialogTitle>
          <DialogDescription>
            Paste a script (or type a topic). Scenes, durations and captions are suggested with simple text rules you can edit before anything is added.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="grid min-h-0 content-start gap-3 overflow-y-auto pr-1">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Paste your script here — paragraphs become scenes.\nMarkdown headings (# Title) become scene titles.\n\nOr type a topic like “5 tips for better sleep”.'}
              className="min-h-56 text-sm"
              maxLength={50_000}
              data-testid="storyboard-text"
            />
            {!text ? (
              <Button variant="link" size="sm" className="justify-self-start px-0" onClick={() => setText(EXAMPLE)}>
                Try an example script
              </Button>
            ) : null}
            <SegmentedField<StoryboardOptions['split']>
              label="One scene per"
              value={options.split}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'paragraphs', label: 'Paragraph' },
                { value: 'sentences', label: 'Sentence' },
              ]}
              onChange={(split) => setOptions((o) => ({ ...o, split }))}
            />
            <SliderField
              label="Narration pace"
              value={options.wordsPerMinute}
              min={100}
              max={220}
              step={5}
              format={(v) => `${v} wpm`}
              onChange={(wordsPerMinute) => setOptions((o) => ({ ...o, wordsPerMinute }))}
            />
            <SliderField
              label="Longest scene"
              value={options.maxSeconds}
              min={5}
              max={30}
              step={0.5}
              format={(v) => `${v}s`}
              onChange={(maxSeconds) => setOptions((o) => ({ ...o, maxSeconds }))}
            />
            <SelectField<StoryboardOptions['captions']>
              label="On-screen captions"
              value={options.captions}
              options={[
                { value: 'full', label: 'Full scene text' },
                { value: 'firstSentence', label: 'First sentence only' },
                { value: 'none', label: 'No captions' },
              ]}
              onChange={(captions) => setOptions((o) => ({ ...o, captions }))}
            />
            <SwitchField
              label="Match imported images"
              hint={images.length ? `${images.length} image/video files available. Matched by file name words, then in order.` : 'Import images first to use them.'}
              checked={options.matchImages && images.length > 0}
              onChange={(matchImages) => setOptions((o) => ({ ...o, matchImages }))}
            />
            {options.matchImages && images.length > 0 ? (
              <SwitchField
                label="Reuse images if there are more scenes"
                checked={options.reuseImages}
                onChange={(reuseImages) => setOptions((o) => ({ ...o, reuseImages }))}
              />
            ) : null}
            {assistants.length > 1 ? (
              <SelectField<string>
                label="Assistant"
                value={assistantId}
                options={assistants.map((a) => ({ value: a.id, label: a.label }))}
                onChange={setAssistantId}
              />
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col rounded-lg border bg-muted/20">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <span className="text-sm font-medium">Storyboard</span>
              <Badge variant="outline" className="font-normal">
                {draft?.source === 'local-model' ? 'Local AI model' : 'Rule-based · no AI'}
              </Badge>
              <span className="ml-auto text-xs text-muted-foreground tabular">
                {scenes.length} scenes · {formatTime(total)}
              </span>
            </div>
            {draft?.notes.length ? (
              <div className="flex gap-2 border-b px-3 py-2 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <div className="grid gap-1">
                  {draft.notes.map((n) => (
                    <p key={n}>{n}</p>
                  ))}
                </div>
              </div>
            ) : null}
            <ScrollArea className="min-h-0 flex-1">
              {scenes.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Your scenes will appear here.</p>
              ) : (
                <ol className="grid gap-2 p-3" data-testid="storyboard-scenes">
                  {scenes.map((s, i) => {
                    const thumb = s.imageId ? assets[s.imageId]?.thumbnailUrl : null
                    return (
                      <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border bg-background/60 p-2">
                        <div className="grid w-24 content-start gap-1">
                          <div
                            className="aspect-video w-24 rounded bg-cover bg-center"
                            style={
                              thumb
                                ? { backgroundImage: `url(${thumb})` }
                                : { backgroundImage: `linear-gradient(135deg, ${paletteFor(i)[0]}, ${paletteFor(i)[1]})` }
                            }
                          />
                          <select
                            aria-label={`Image for scene ${i + 1}`}
                            className="h-6 w-24 rounded border bg-background text-[11px]"
                            value={s.imageId ?? ''}
                            onChange={(e) => editScene(i, { imageId: e.target.value || null, imageReason: e.target.value ? 'Chosen by you' : null })}
                          >
                            <option value="">Gradient</option>
                            {images.map((img) => (
                              <option key={img.id} value={img.id}>
                                {img.name}
                              </option>
                            ))}
                          </select>
                          {s.imageReason ? <span className="text-[10px] leading-tight text-muted-foreground">{s.imageReason}</span> : null}
                        </div>
                        <div className="grid min-w-0 gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-muted-foreground tabular">{i + 1}</span>
                            <Input
                              aria-label={`Title of scene ${i + 1}`}
                              value={s.title}
                              onChange={(e) => editScene(i, { title: e.target.value })}
                              className="h-7 text-sm"
                            />
                            <Input
                              aria-label={`Duration of scene ${i + 1} in seconds`}
                              type="number"
                              min={0.5}
                              max={60}
                              step={0.5}
                              value={s.duration}
                              onChange={(e) => editScene(i, { duration: Math.max(0.5, Math.min(60, Number(e.target.value) || 0.5)) })}
                              className="h-7 w-20 text-sm tabular"
                            />
                            <Button variant="ghost" size="icon-xs" aria-label={`Remove scene ${i + 1}`} onClick={() => removeScene(i)}>
                              <Trash2 />
                            </Button>
                          </div>
                          <Textarea
                            aria-label={`Caption for scene ${i + 1}`}
                            value={s.caption}
                            onChange={(e) => editScene(i, { caption: e.target.value })}
                            rows={2}
                            placeholder="No caption"
                            className="min-h-12 text-xs"
                          />
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </ScrollArea>
          </div>
        </div>
        <DialogFooter className="items-center gap-3 sm:justify-between">
          {project.scenes.length > 0 ? (
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
          <div className="flex items-center gap-3">
            {over ? <span className="text-xs text-destructive">Over the 5-minute limit — remove or shorten scenes.</span> : null}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={!scenes.length || over} data-testid="storyboard-create">
              <Wand2 /> Create {scenes.length || ''} scene{scenes.length === 1 ? '' : 's'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
