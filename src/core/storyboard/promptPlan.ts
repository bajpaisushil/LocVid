import type { MotionPreset, TextAnimation, TransitionType } from '../types'

/**
 * "Describe your video" planner. Turns one sentence such as
 * "create a video showing a boy playing football in a village" into a shot
 * list: per-shot image prompts (for a local image model), captions, camera
 * motion and transitions. Deterministic text rules — no language model — so
 * the same prompt always gives the same plan, and it works offline.
 */

export type VisualStyle = 'cartoon' | 'photo' | 'anime' | 'watercolor' | 'render3d' | 'cinematic'

export const STYLE_LABELS: Record<VisualStyle, string> = {
  cartoon: 'Cartoon',
  photo: 'Photo',
  anime: 'Anime',
  watercolor: 'Watercolor',
  render3d: '3D render',
  cinematic: 'Cinematic',
}

const STYLE_SUFFIX: Record<VisualStyle, string> = {
  cartoon: 'colorful cartoon illustration, clean lines, vibrant colors',
  photo: 'photograph, natural light, sharp focus, high detail',
  anime: 'anime style illustration, vivid colors, detailed background',
  watercolor: 'watercolor painting, soft colors, paper texture',
  render3d: '3d render, soft studio lighting, pixar style',
  cinematic: 'cinematic film still, dramatic lighting, shallow depth of field',
}

export interface PlannedShot {
  title: string
  caption: string
  imagePrompt: string
  duration: number
  motion: MotionPreset
  transition: TransitionType
  captionAnimation: TextAnimation
}

export interface PromptPlan {
  subject: string
  title: string
  shots: PlannedShot[]
}

const LEADING_PHRASES = [
  /^(please\s+)?(can you\s+)?(create|make|generate|produce|build|give me|show me|i want|i'd like|i would like)\s+(me\s+)?(an?\s+)?(short\s+|quick\s+|small\s+)?(video|clip|film|reel|short|animation|movie)?\s*/i,
  /^(an?\s+)?(short\s+|quick\s+|small\s+)?(video|clip|film|reel|animation|movie)\s+/i,
  /^(of|about|showing|that shows|which shows|where|with|featuring|on)\s+/i,
]

/** Strip the "create a video showing…" framing, keeping the subject. */
export function extractSubject(prompt: string): string {
  let s = prompt.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')
  for (let i = 0; i < 3; i++) for (const re of LEADING_PHRASES) s = s.replace(re, '')
  return s.trim() || prompt.trim()
}

function titleCase(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

/** Shot templates: framing for the image model + on-screen caption. */
const SHOTS: { title: string; frame: string; caption: (subject: string) => string; motion: MotionPreset }[] = [
  { title: 'Opening', frame: 'wide establishing shot of', caption: (s) => titleCase(s), motion: 'zoomIn' },
  { title: 'Close-up', frame: 'close-up portrait of', caption: () => 'Meet the star', motion: 'kenBurns' },
  { title: 'In action', frame: 'dynamic action shot of', caption: () => 'Here we go!', motion: 'panRight' },
  { title: 'The moment', frame: 'dramatic low angle shot of', caption: () => 'The big moment', motion: 'zoomOut' },
  { title: 'Details', frame: 'detailed close shot of', caption: () => 'Every detail counts', motion: 'panLeft' },
  { title: 'Teamwork', frame: 'group scene of', caption: () => 'Better together', motion: 'kenBurns' },
  { title: 'Celebration', frame: 'joyful celebration of', caption: () => 'What a finish!', motion: 'parallax' },
  { title: 'Overview', frame: 'aerial view of', caption: () => 'The whole story', motion: 'zoomOut' },
  { title: 'Reflection', frame: 'calm golden hour scene of', caption: () => 'A day to remember', motion: 'kenBurns' },
  { title: 'Finale', frame: 'beautiful final shot of', caption: () => 'The end', motion: 'zoomIn' },
]

const TRANSITIONS: TransitionType[] = ['crossfade', 'slideLeft', 'crossfade', 'zoom', 'crossfade', 'wipeLeft']

export interface PlanOptions {
  /** Target length in seconds. */
  length: number
  style: VisualStyle
}

export function planVideo(prompt: string, options: PlanOptions): PromptPlan {
  const subject = extractSubject(prompt)
  const perShot = options.length <= 20 ? 3.5 : 4.5
  const count = Math.max(3, Math.min(SHOTS.length, Math.round(options.length / perShot)))
  // Always open with the establishing shot and end with the celebration/finale.
  const middle = SHOTS.slice(1, -1)
  const picks = [SHOTS[0]!, ...middle.slice(0, count - 2), SHOTS[SHOTS.length - 1]!]
  const duration = Math.round((options.length / count) * 10) / 10
  const shots = picks.map((shot, i) => ({
    title: shot.title,
    caption: shot.caption(subject),
    imagePrompt: `${shot.frame} ${subject}, ${STYLE_SUFFIX[options.style]}`,
    duration,
    motion: shot.motion,
    transition: i === 0 ? ('fadeBlack' as const) : TRANSITIONS[(i - 1) % TRANSITIONS.length]!,
    captionAnimation: (i === 0 ? 'slideUp' : 'fade') as TextAnimation,
  }))
  return { subject, title: titleCase(subject).slice(0, 80), shots }
}
