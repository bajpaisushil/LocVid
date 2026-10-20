import type { GradePreset } from '@/core/types'

/** Parametric color grades (no LUT files): white balance, contrast, lift/gamma/gain, saturation, split toning. */
export interface Grade {
  temperature: number
  tint: number
  contrast: number
  lift: [number, number, number]
  gamma: [number, number, number]
  gain: [number, number, number]
  saturation: number
  shadows: [number, number, number]
  highlights: [number, number, number]
  fade: number
}

const NEUTRAL: Grade = {
  temperature: 0,
  tint: 0,
  contrast: 1,
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
  saturation: 1,
  shadows: [0, 0, 0],
  highlights: [0, 0, 0],
  fade: 0,
}

export const GRADES: Record<GradePreset, Grade> = {
  none: NEUTRAL,
  // Teal shadows, warm highlights, a touch more contrast — the blockbuster look.
  cinematic: { ...NEUTRAL, contrast: 1.12, saturation: 1.05, shadows: [-0.02, 0.025, 0.045], highlights: [0.045, 0.02, -0.025], gamma: [1, 1, 1.02] },
  warm: { ...NEUTRAL, temperature: 0.9, tint: 0.1, contrast: 1.04, saturation: 1.06, highlights: [0.03, 0.015, -0.01] },
  cool: { ...NEUTRAL, temperature: -0.9, contrast: 1.05, saturation: 0.95, shadows: [-0.01, 0.01, 0.04] },
  vivid: { ...NEUTRAL, contrast: 1.12, saturation: 1.32, gain: [1.03, 1.03, 1.03] },
  noir: { ...NEUTRAL, contrast: 1.32, saturation: 0, gamma: [0.95, 0.95, 0.95] },
  vintage: { ...NEUTRAL, temperature: 0.5, contrast: 0.92, saturation: 0.78, lift: [0.06, 0.05, 0.03], shadows: [0, 0.015, 0], fade: 0.35 },
  dreamy: { ...NEUTRAL, temperature: 0.25, contrast: 0.9, saturation: 0.92, lift: [0.07, 0.06, 0.08], highlights: [0.03, 0.01, 0.04], fade: 0.25 },
}
