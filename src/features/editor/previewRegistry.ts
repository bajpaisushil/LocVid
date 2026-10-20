import type { PreviewEngine } from '@/preview/engine'

let active: PreviewEngine | null = null

/** The mounted preview engine (used for project posters). */
export function getPreviewEngine(): PreviewEngine | null {
  return active
}

export function setPreviewEngine(engine: PreviewEngine | null): void {
  active = engine
}
