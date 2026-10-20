import type { Easing } from '@/core/types'

export const ease = {
  linear: (t: number) => t,
  easeIn: (t: number) => t * t * t,
  easeOut: (t: number) => 1 - (1 - t) ** 3,
  easeInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  smooth: (t: number) => t * t * (3 - 2 * t),
  /** Slight overshoot, for "pop" text animations. */
  backOut: (t: number) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
  },
} satisfies Record<string, (t: number) => number>

export function applyEasing(easing: Easing, t: number): number {
  return ease[easing](t)
}
