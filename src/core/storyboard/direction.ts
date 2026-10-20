import type { AspectRatio, Atmosphere, CameraMove, CropRect, FocusMode, LookSettings } from '../types'
import { cropAround } from '@/render/fit'
import type { VisualStyle } from './promptPlan'

/**
 * Shot direction for "Describe your video": how each planned shot is framed
 * and filmed, so a sequence reads as edited footage (wide → close-up → detail,
 * each with its own camera move) rather than a slideshow.
 */

export type Framing = 'wide' | 'medium' | 'close' | 'detail'

export interface ShotDirection {
  framing: Framing
  camera: CameraMove
  focus: FocusMode
  haze: number
}

const DIRECTION: Record<string, ShotDirection> = {
  Opening: { framing: 'wide', camera: 'dollyIn', focus: 'none', haze: 0.18 },
  'Close-up': { framing: 'close', camera: 'orbitRight', focus: 'subject', haze: 0 },
  'In action': { framing: 'medium', camera: 'truckLeft', focus: 'none', haze: 0.08 },
  'The moment': { framing: 'medium', camera: 'craneUp', focus: 'subject', haze: 0.05 },
  Details: { framing: 'detail', camera: 'dollyIn', focus: 'rack', haze: 0 },
  Teamwork: { framing: 'wide', camera: 'orbitLeft', focus: 'none', haze: 0.1 },
  Celebration: { framing: 'medium', camera: 'float', focus: 'subject', haze: 0.05 },
  Overview: { framing: 'wide', camera: 'dollyOut', focus: 'none', haze: 0.2 },
  Reflection: { framing: 'medium', camera: 'float', focus: 'none', haze: 0.12 },
  Finale: { framing: 'wide', camera: 'dollyOut', focus: 'none', haze: 0.15 },
}

const FALLBACK_MOVES: CameraMove[] = ['dollyIn', 'orbitRight', 'craneUp', 'truckLeft', 'float', 'dollyOut']

export function directShot(title: string, index: number): ShotDirection {
  return DIRECTION[title] ?? { framing: index % 2 ? 'medium' : 'wide', camera: FALLBACK_MOVES[index % FALLBACK_MOVES.length]!, focus: 'none', haze: 0.1 }
}

/** Film look per visual style — realistic styles get a cinema treatment, illustrated ones stay vivid. */
export function lookForStyle(style: VisualStyle, aspect: AspectRatio): LookSettings {
  const bars = aspect === '16:9'
  switch (style) {
    case 'photo':
    case 'cinematic':
      return { grade: 'cinematic', atmosphere: 'dust', grain: 0.3, vignette: 0.45, bloom: 0.15, letterbox: bars }
    case 'cartoon':
    case 'anime':
      return { grade: 'vivid', atmosphere: 'dust', grain: 0.06, vignette: 0.25, bloom: 0.25, letterbox: false }
    case 'watercolor':
      return { grade: 'dreamy', atmosphere: 'dust', grain: 0.18, vignette: 0.3, bloom: 0.2, letterbox: false }
    case 'render3d':
      return { grade: 'warm', atmosphere: 'dust', grain: 0.1, vignette: 0.3, bloom: 0.3, letterbox: bars }
  }
}

const ATMOSPHERE_KEYWORDS: [RegExp, Atmosphere][] = [
  [/\b(snow\w*|winter|christmas|blizzard|frost\w*|ice|icy)\b/i, 'snow'],
  [/\b(rain\w*|storm\w*|monsoon|drizzle|wet)\b/i, 'rain'],
  [/\b(fire|camp\s?fire|lava|volcano|forge|diwali|ember\w*|torch\w*|bonfire)\b/i, 'embers'],
  [/\b(night|forest|magic\w*|fair(y|ies)|firefl\w*|glow\w*|enchanted)\b/i, 'fireflies'],
  [/\b(party|festival|celebrat\w*|wedding|stars?|sparkl\w*|birthday|fireworks?)\b/i, 'sparkles'],
]

export function atmosphereForPrompt(prompt: string): Atmosphere {
  for (const [re, atmosphere] of ATMOSPHERE_KEYWORDS) if (re.test(prompt)) return atmosphere
  return 'dust'
}

const ZOOM: Record<Framing, number> = { wide: 1, medium: 1.45, close: 2.1, detail: 2.4 }

/**
 * The crop for a framing, centered on the subject (from depth analysis) when
 * known. Returns null for a full "wide" frame.
 */
export function framingCrop(
  framing: Framing,
  subject: [number, number, number, number] | null,
  srcW: number,
  srcH: number,
  frameAspect: number,
  variant = 0,
  outputShortSide = 720,
): CropRect | null {
  if (framing === 'wide') return null
  // Don't magnify a small picture past what still looks sharp: a 512 px AI image gets gentle
  // close-ups, a 4000 px photo the full range.
  const maxZoom = Math.min(ZOOM.detail, Math.max(1.25, Math.min(srcW, srcH) / (outputShortSide * 0.62)))
  const [sx, sy, sw, sh] = subject ?? [0.3, 0.25, 0.4, 0.5]
  let center = { x: sx + sw / 2, y: sy + sh * (framing === 'close' ? 0.32 : 0.45) }
  if (framing === 'detail') {
    // A different spot than the subject's face: alternate lower-left / lower-right of the subject.
    center = { x: sx + sw * (variant % 2 ? 0.75 : 0.25), y: sy + sh * 0.7 }
  }
  return cropAround(center, Math.min(ZOOM[framing], maxZoom), srcW, srcH, frameAspect)
}
