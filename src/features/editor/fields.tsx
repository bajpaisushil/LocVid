import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { clamp } from '@/lib/math'
import { cn } from '@/lib/utils'

/** Compact, labelled form controls for the properties panel. */

export function Section({
  title,
  id,
  children,
  defaultOpen = true,
  action,
}: {
  title: string
  id?: string
  children: ReactNode
  defaultOpen?: boolean
  action?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section id={id} className="border-b px-3 py-3" aria-label={title}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex flex-1 items-center gap-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown className={cn('size-3.5 transition', !open && '-rotate-90')} />
          {title}
        </button>
        {action}
      </div>
      {open ? <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">{children}</div> : null}
    </section>
  )
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground/80">{hint}</p> : null}
    </div>
  )
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format = (v) => v.toFixed(2),
  disabled,
  testId,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange(value: number): void
  format?: (v: number) => string
  disabled?: boolean
  testId?: string
}) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
        <span className="text-[11px] text-muted-foreground tabular">{format(value)}</span>
      </div>
      <Slider
        id={id}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[clamp(value, min, max)]}
        onValueChange={([v]) => v !== undefined && onChange(v)}
        disabled={disabled}
        data-testid={testId}
      />
    </div>
  )
}

/** Number input that commits on blur/Enter, so typing "1." doesn't fight the store. */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 0.1,
  suffix,
  onCommit,
  testId,
  placeholder,
  allowEmpty,
}: {
  label: string
  value: number | null
  min?: number
  max?: number
  step?: number
  suffix?: string
  onCommit(value: number | null): void
  testId?: string
  placeholder?: string
  allowEmpty?: boolean
}) {
  const id = useId()
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  // Reset the draft when the value changes from outside (undo, drag on the timeline).
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setDraft(value === null ? '' : String(value))
  }
  const commit = () => {
    if (draft.trim() === '' && allowEmpty) {
      onCommit(null)
      return
    }
    const n = Number(draft)
    if (!Number.isFinite(n)) {
      setDraft(value === null ? '' : String(value))
      return
    }
    const v = clamp(n, min ?? -Infinity, max ?? Infinity)
    onCommit(v)
    setDraft(String(v))
  }
  return (
    <Field label={label} htmlFor={id}>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          className="h-8 pr-8 text-sm tabular"
          value={draft}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
          data-testid={testId}
        />
        {suffix ? (
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
        ) : null}
      </div>
    </Field>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  disabled,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string; disabled?: boolean }[]
  onChange(value: T): void
  testId?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id}>
      <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
        <SelectTrigger id={id} size="sm" className="w-full min-w-0" data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export function SwitchField({
  label,
  checked,
  onChange,
  hint,
  testId,
}: {
  label: string
  checked: boolean
  onChange(checked: boolean): void
  hint?: string
  testId?: string
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {hint ? <span className="text-[11px] text-muted-foreground/80">{hint}</span> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  )
}

export function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string
  value: T
  options: readonly { value: T; label: ReactNode; title?: string }[]
  onChange(value: T): void
  testId?: string
}) {
  return (
    <Field label={label}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        className="w-full"
        aria-label={label}
        data-testid={testId}
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} className="flex-1 text-xs" title={o.title} aria-label={o.title}>
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  )
}

export function ColorField({ label, value, onChange, testId }: { label: string; value: string; onChange(value: string): void; testId?: string }) {
  const id = useId()
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
          data-testid={testId}
        />
        <span className="text-xs text-muted-foreground uppercase tabular">{hex}</span>
      </div>
    </Field>
  )
}
