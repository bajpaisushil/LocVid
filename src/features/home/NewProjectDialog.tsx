import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AspectRatio } from '@/core/types'
import { cn } from '@/lib/utils'

const OPTIONS: { value: AspectRatio; title: string; hint: string; box: string }[] = [
  { value: '16:9', title: 'Landscape 16:9', hint: 'YouTube, presentations', box: 'h-9 w-16' },
  { value: '9:16', title: 'Vertical 9:16', hint: 'Shorts, Reels, TikTok', box: 'h-16 w-9' },
  { value: '1:1', title: 'Square 1:1', hint: 'Feed posts', box: 'h-12 w-12' },
]

export interface NewProjectDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  onCreate(input: { name: string; aspectRatio: AspectRatio }): Promise<void> | void
}

export function NewProjectDialog({ open, onOpenChange, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState('')
  const [aspect, setAspect] = useState<AspectRatio>('16:9')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
        if (!next) setName('')
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-5"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await onCreate({ name: name.trim() || 'Untitled project', aspectRatio: aspect })
              setName('')
            } finally {
              setBusy(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>You can change the format later in project settings.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-project-name">Name</Label>
            <Input
              id="new-project-name"
              placeholder="My video"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
              autoComplete="off"
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Format</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup">
              {OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-3 text-center transition has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                    aspect === o.value ? 'border-primary bg-primary/10' : 'hover:bg-muted/60',
                  )}
                >
                  <input
                    type="radio"
                    name="aspect"
                    value={o.value}
                    checked={aspect === o.value}
                    onChange={() => setAspect(o.value)}
                    className="sr-only"
                  />
                  <span className="flex h-16 items-center">
                    <span className={cn('rounded-sm border-2', o.box, aspect === o.value ? 'border-primary' : 'border-muted-foreground/50')} />
                  </span>
                  <span className="text-sm font-medium">{o.title}</span>
                  <span className="text-xs text-muted-foreground">{o.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} data-testid="create-project">
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
