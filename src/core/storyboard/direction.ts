import type { AspectRatio, Atmosphere, CameraMove, CropRect, FocusMode, LookSettings, PropKind, SubjectAction } from '../types'
import { cropAround } from '@/render/fit'
import type { VisualStyle } from './promptPlan'

/**
 * Shot direction for "Describe your video": how each planned shot is framed
 * and filmed, so a sequence reads as edited footage (wide → close-up → detail,
 * each with its own camera move) rather than a slideshow.
 */

/** wide: the whole picture's width (subject-aware); full: the whole subject with room around it. */
export type Framing = 'wide' | 'full' | 'medium' | 'close' | 'detail'

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

const ZOOM: Record<Framing, number> = { wide: 1, full: 1, medium: 1.45, close: 2.1, detail: 2.4 }

/**
 * The crop for a framing, placed around the subject (from the cut-out or the
 * depth analysis) when known. Returns null for a plain centered full frame.
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
  if (framing === 'wide' && !subject) return null
  // Don't magnify a small picture past what still looks sharp: a 512 px AI image gets gentle
  // close-ups, a 4000 px photo the full range.
  const maxZoom = Math.min(ZOOM.detail, Math.max(1.25, Math.min(srcW, srcH) / (outputShortSide * 0.62)))
  const [sx, sy, sw, sh] = subject ?? [0.3, 0.25, 0.4, 0.5]
  // Height (normalized to the picture) of a full frame-aspect crop.
  const fullH = srcW / srcH > frameAspect ? 1 : srcW / frameAspect / srcH
  if (framing === 'wide' || framing === 'full') {
    let zoom = 1
    if (framing === 'full') {
      // Tight enough to fill the frame with the subject, loose enough to keep all of it with some room.
      const needH = Math.max(sh * 1.22, ((sw * srcW * 1.3) / frameAspect) / srcH)
      zoom = Math.min(maxZoom, Math.max(1, fullH / needH))
    }
    const h = fullH / zoom
    // The subject fits: center it a touch low (headroom). Too tall: keep the head, lose the feet.
    const cy = sh <= h * 0.9 ? sy + sh * 0.46 : sy - h * 0.05 + h / 2
    return cropAround({ x: sx + sw / 2, y: cy }, zoom, srcW, srcH, frameAspect)
  }
  let center = { x: sx + sw / 2, y: sy + sh * (framing === 'close' ? 0.32 : 0.45) }
  if (framing === 'detail') {
    // A different spot than the subject's face: alternate lower-left / lower-right of the subject.
    center = { x: sx + sw * (variant % 2 ? 0.75 : 0.25), y: sy + sh * 0.7 }
  }
  return cropAround(center, Math.min(ZOOM[framing], maxZoom), srcW, srcH, frameAspect)
}

// ---------------------------------------------------------------------------
// Subject animation and props from the prompt
// ---------------------------------------------------------------------------

/** What the subject is doing, read from the prompt's verbs. */
export type Activity = 'football' | 'dance' | 'run' | 'walk' | 'jump' | 'fly' | 'play' | 'still'

const ACTIVITIES: [RegExp, Activity][] = [
  [/\b(foot\s?ball|soccer|kick\w*|dribbl\w*|goals?|striker)\b/i, 'football'],
  [/\b(danc\w*|ballet|twirl\w*|groov\w*|disco)\b/i, 'dance'],
  [/\b(run|runs|running|ran|race|races|racing|sprint\w*|chas\w*|jog\w*)\b/i, 'run'],
  [/\b(walk\w*|stroll\w*|hik(e|es|ing)|wander\w*|march\w*|explor\w*)\b/i, 'walk'],
  [/\b(jump\w*|hop|hops|hopping|bounc\w*|skipping|leap\w*|trampoline)\b/i, 'jump'],
  [/\b(fly|flies|flying|flew|float\w*|hover\w*|swim\w*|soar\w*|glid\w*)\b/i, 'fly'],
  [/\b(play\w*|game|games|fun|cricket|basketball|tennis)\b/i, 'play'],
]

export function activityFor(prompt: string): Activity {
  for (const [re, activity] of ACTIVITIES) if (re.test(prompt)) return activity
  return 'still'
}

export type SubjectKind = 'person' | 'animal' | 'object' | 'unknown'

const PERSON_RE =
  /\b(boys?|girls?|man|men|woman|women|kids?|child|children|baby|babies|toddlers?|teens?|teenagers?|people|person|friends?|family|team|players?|dancers?|runners?|he|she|mom|mother|dad|father|grand(ma|pa|mother|father)|king|queen|prince|princess|hero|superhero|student|teacher|chef|farmer|soldier|doctor|astronaut|ninja|pirate|wizard|bride|groom|couple|lady|gentleman|guy|character)\b/i
const ANIMAL_RE =
  /\b(dogs?|pupp(y|ies)|cats?|kittens?|horses?|cows?|elephants?|lions?|tigers?|bears?|birds?|parrots?|ducks?|rabbits?|bunn(y|ies)|monkeys?|deer|fox(es)?|wolf|wolves|pandas?|penguins?|fish|dolphins?|whales?|dinosaurs?|dragons?|unicorns?|owls?|eagles?|frogs?|turtles?)\b/i
const OBJECT_RE =
  /\b(lighthouses?|cars?|trucks?|bus|train|houses?|buildings?|towers?|bridges?|castles?|temples?|church|mosque|statues?|mountains?|trees?|boats?|ships?|planes?|airplanes?|rockets?|city|skyline|landscape|waterfalls?|lake|river|planet|moon|clock|phone|cake|food|bottle|product)\b/i

export function subjectKind(prompt: string): SubjectKind {
  if (PERSON_RE.test(prompt)) return 'person'
  if (ANIMAL_RE.test(prompt)) return 'animal'
  if (OBJECT_RE.test(prompt)) return 'object'
  return 'unknown'
}

type ShotActions = Partial<Record<string, SubjectAction>> & { default: SubjectAction }

const ACTION_PLAN: Record<Activity, ShotActions> = {
  football: { Opening: 'breathe', 'Close-up': 'breathe', 'In action': 'run', 'The moment': 'kick', Details: 'breathe', Teamwork: 'run', Celebration: 'jump', Overview: 'walk', Reflection: 'sway', Finale: 'breathe', default: 'run' },
  dance: { Opening: 'sway', 'Close-up': 'sway', Details: 'sway', Celebration: 'jump', Reflection: 'sway', default: 'dance' },
  run: { Opening: 'breathe', 'Close-up': 'breathe', Details: 'breathe', Celebration: 'jump', Reflection: 'sway', Finale: 'walk', default: 'run' },
  walk: { Opening: 'approach', 'Close-up': 'breathe', 'The moment': 'approach', Details: 'breathe', Celebration: 'sway', Reflection: 'sway', default: 'walk' },
  jump: { Opening: 'breathe', 'Close-up': 'sway', Details: 'breathe', Reflection: 'sway', Finale: 'breathe', default: 'jump' },
  fly: { default: 'float' },
  play: { Opening: 'breathe', 'Close-up': 'breathe', 'In action': 'run', 'The moment': 'jump', Teamwork: 'run', Celebration: 'jump', Details: 'breathe', default: 'sway' },
  still: { 'Close-up': 'breathe', 'In action': 'sway', Celebration: 'sway', 'The moment': 'approach', default: 'breathe' },
}

export interface SubjectDirection {
  action: SubjectAction
  amount: number
  /** Override of the shot's framing so the whole body (feet, ball) is in view. */
  framing?: Framing
  camera?: CameraMove
}

/**
 * What the cut-out subject does in a planned shot. Objects (a lighthouse, a
 * car) stay put unless the prompt says they move; people and animals always
 * get at least a little life.
 */
export function directSubject(prompt: string, title: string): SubjectDirection {
  const activity = activityFor(prompt)
  const kind = subjectKind(prompt)
  if (activity === 'still' && kind === 'object') return { action: 'none', amount: 0.6 }
  const plan = ACTION_PLAN[activity]
  const action = plan[title] ?? plan.default
  const amount = action === 'kick' ? 0.85 : action === 'dance' ? 0.75 : action === 'breathe' || action === 'sway' ? 0.55 : 0.65
  const wholeBody = action === 'run' || action === 'walk' || action === 'jump' || action === 'kick' || action === 'dance'
  const camera: CameraMove | undefined = action === 'jump' ? 'craneUp' : action === 'dance' ? 'orbitRight' : action === 'kick' ? 'dollyIn' : undefined
  return { action, amount, framing: wholeBody ? 'full' : undefined, camera }
}

/** Face toward the larger side of the frame, so walking, running and kicking have somewhere to go. */
export function facingFor(subject: [number, number, number, number] | null, crop: CropRect | null): 'left' | 'right' {
  if (!subject) return 'right'
  const cx = subject[0] + subject[2] / 2
  const mid = crop ? crop.x + crop.width / 2 : 0.5
  return cx <= mid ? 'right' : 'left'
}

/** A sideways tracking move that follows a subject traveling left or right. */
export function trackingCamera(direction: 'left' | 'right'): CameraMove {
  return direction === 'right' ? 'truckRight' : 'truckLeft'
}

const OUTDOOR = /\b(sky|beach|sea|ocean|village|field|fields|park|mountains?|lake|river|farm|morning|sunrise|sunset|countryside|meadow|hills?|coast|outdoors?|garden|playground|stadium|ground)\b/i
const PARTY = /\b(birthday|party|balloons?|carnival|fair)\b/i
const CELEBRATE = /\b(win\w*|victory|goals?|celebrat\w*|cheer\w*|champions?|trophy|festival|wedding|party|birthday|new year)\b/i
const ROMANCE = /\b(wedding|love|romanc\w*|spring|blossom\w*|cherry|sakura|valentine)\b/i
const AUTUMN = /\b(autumn|fall|forest|woods|leaves)\b/i
const LIGHTS = /\b(diwali|lanterns?|festival of lights|new year|night sky)\b/i
const GARDEN = /\b(garden|flowers?|meadow|butterfl\w*|spring)\b/i

const WIDE_SHOTS = new Set(['Opening', 'Overview', 'Finale', 'Reflection'])

/** 3D props for a shot, from the prompt's words (at most two, so a shot never gets busy). */
export function propsForShot(prompt: string, title: string, action: SubjectAction): PropKind[] {
  const out: PropKind[] = []
  const add = (kind: PropKind, when: boolean) => {
    if (when && !out.includes(kind) && out.length < 2) out.push(kind)
  }
  add('football', activityFor(prompt) === 'football' && (action === 'kick' || action === 'run' || title === 'Opening' || title === 'Teamwork'))
  add('confetti', title === 'Celebration' && CELEBRATE.test(prompt))
  add('balloons', PARTY.test(prompt) && (title === 'Opening' || title === 'Celebration' || title === 'Finale'))
  add('lanterns', LIGHTS.test(prompt) && (WIDE_SHOTS.has(title) || title === 'Celebration'))
  add('petals', ROMANCE.test(prompt) && (WIDE_SHOTS.has(title) || title === 'Close-up'))
  add('leaves', AUTUMN.test(prompt) && WIDE_SHOTS.has(title))
  add('butterflies', GARDEN.test(prompt) && (title === 'In action' || title === 'Details' || title === 'Reflection'))
  add('birds', OUTDOOR.test(prompt) && WIDE_SHOTS.has(title))
  return out
}
