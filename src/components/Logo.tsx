import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span className="brand-gradient grid size-7 place-items-center rounded-lg shadow-md shadow-primary/30" aria-hidden>
        <svg viewBox="0 0 24 24" className="size-3.5 translate-x-px fill-white">
          <path d="M7 4.5v15l12.5-7.5z" />
        </svg>
      </span>
      <span>LocVid</span>
    </span>
  )
}
