import { useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { useDialogQueue, type PromptRequest } from './dialog-api'

/** Renders whichever confirm/prompt dialog is currently requested via `dialog-api`. */
export function DialogHost() {
  const current = useDialogQueue((s) => s.current)
  const clear = useDialogQueue((s) => s.set)
  if (!current) return null
  if (current.kind === 'confirm') {
    const finish = (ok: boolean) => {
      current.resolve(ok)
      clear(null)
    }
    return (
      <AlertDialog open onOpenChange={(open) => !open && finish(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{current.title}</AlertDialogTitle>
            {current.description ? <AlertDialogDescription>{current.description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => finish(false)}>{current.cancelLabel ?? 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              variant={current.destructive ? 'destructive' : 'default'}
              onClick={() => finish(true)}
              data-testid="confirm-action"
            >
              {current.confirmLabel ?? 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return <PromptDialog key={current.title} request={current} onDone={() => clear(null)} />
}

function PromptDialog({ request, onDone }: { request: PromptRequest; onDone: () => void }) {
  const [value, setValue] = useState(request.initialValue ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.select())
    return () => cancelAnimationFrame(id)
  }, [])
  const finish = (result: string | null) => {
    request.resolve(result)
    onDone()
  }
  const trimmed = value.trim()
  return (
    <Dialog open onOpenChange={(open) => !open && finish(null)}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (trimmed) finish(trimmed)
          }}
        >
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
            {request.description ? <DialogDescription>{request.description}</DialogDescription> : null}
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="prompt-input">{request.label}</Label>
            <Input
              id="prompt-input"
              ref={inputRef}
              value={value}
              maxLength={request.maxLength ?? 200}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed}>
              {request.confirmLabel ?? 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
