import { ArrowRight, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { navigate } from '@/app/router'
import { Button } from '@/components/ui/button'
import { createProject } from '@/core/defaults'
import { extractSubject } from '@/core/storyboard/promptPlan'
import type { AspectRatio } from '@/core/types'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { setPendingPrompt } from '@/features/prompt/pendingPrompt'
import { saveProject } from '@/storage/repo'

const EXAMPLES = ['A boy playing football in a village at sunset', 'A cozy rainy-day coffee shop', 'Top 5 tips for better sleep']

/** Start a project from one sentence: creates it, then opens "Describe your video" pre-filled. */
export function PromptHero() {
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState<AspectRatio>('16:9')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    const text = prompt.trim()
    if (!text) return
    setBusy(true)
    try {
      const subject = extractSubject(text)
      const project = createProject({ name: subject.charAt(0).toUpperCase() + subject.slice(1, 60), aspectRatio: aspect })
      await saveProject(project)
      setPendingPrompt(project.id, text)
      navigate({ name: 'editor', projectId: project.id })
    } catch (error) {
      toast.error('Could not start the project', { description: errorMessage(error) })
      setBusy(false)
    }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border bg-card/70 p-5 sm:p-6" aria-labelledby="describe-heading">
      <div className="brand-gradient pointer-events-none absolute -top-24 -right-24 size-64 rounded-full opacity-20 blur-3xl" />
      <h1 id="describe-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Wand2 className="size-5 text-primary" /> Describe your video
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Type what it should show. LocVid plans the shots, creates a picture for each (with an optional on-device AI model, your own photos, or
        designed backgrounds) and animates them into a video you can edit and export.
      </p>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={300}
          placeholder="e.g. Create a video showing a boy playing football in a village"
          aria-label="Describe your video"
          className="h-11 min-w-0 flex-1 rounded-lg border bg-background/60 px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="home-prompt"
        />
        <div className="flex gap-2">
          <div className="flex rounded-lg border p-0.5" role="radiogroup" aria-label="Format">
            {(['16:9', '9:16', '1:1'] as const).map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={aspect === a}
                onClick={() => setAspect(a)}
                className={cn('rounded-md px-2.5 text-xs transition', aspect === a ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {a}
              </button>
            ))}
          </div>
          <Button type="submit" size="lg" className="h-11" disabled={!prompt.trim() || busy} data-testid="home-prompt-go">
            Start <ArrowRight />
          </Button>
        </div>
      </form>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setPrompt(ex)}
            className="rounded-full border px-2.5 py-1 text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          >
            {ex}
          </button>
        ))}
      </div>
    </section>
  )
}
