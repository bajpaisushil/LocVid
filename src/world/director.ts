import type {
  Atmosphere,
  CastKind,
  CastMember,
  LookSettings,
  TransitionType,
  WorldAction,
  WorldActivity,
  WorldPlace,
  WorldShot,
  WorldSpec,
  WorldTimeOfDay,
  WorldWeather,
} from '@/core/types'
import { activityFor } from '@/core/storyboard/direction'
import { extractSubject } from '@/core/storyboard/promptPlan'
import { hashString } from '@/lib/id'

/**
 * Turns a sentence ("create video of a village boy playing") into a live 3D
 * story: where it happens, when, who is in it, what they do — and an edit of
 * shots that films that story (establishing crane, close-up, tracking run,
 * the big moment from a low angle, the celebration in orbit, …). Rule-based
 * and deterministic: the same prompt always makes the same video.
 */

export interface WorldShotPlan {
  title: string
  shot: WorldShot
  action: WorldAction
  /** Seconds into the story where the shot starts. */
  start: number
  duration: number
  transition: TransitionType
}

export interface WorldPlan {
  title: string
  world: WorldSpec
  shots: WorldShotPlan[]
  look: LookSettings
}

const PLACES: [RegExp, WorldPlace][] = [
  [/\b(snow\w*|winter|ice|icy|christmas|ski\w*)\b/i, 'snow'],
  [/\b(beach\w*|sea|seaside|ocean|coast\w*|shore|island|sand)\b/i, 'beach'],
  [/\b(city|cities|street\w*|town|urban|downtown|road|plaza|market)\b/i, 'city'],
  [/\b(park|garden\w*|playground|meadow|forest|woods|lawn)\b/i, 'park'],
  [/\b(village\w*|rural|farm\w*|countryside|hamlet|gaon|field\w*)\b/i, 'village'],
]

const TIMES: [RegExp, WorldTimeOfDay][] = [
  [/\b(night\w*|midnight|moon\w*|stars?|diwali)\b/i, 'night'],
  [/\b(sunset|evening|dusk|golden hour|twilight)\b/i, 'sunset'],
  [/\b(morning|sunrise|dawn|early)\b/i, 'morning'],
]

export function placeFor(prompt: string, activity: WorldActivity): WorldPlace {
  for (const [re, place] of PLACES) if (re.test(prompt)) return place
  return activity === 'dance' || activity === 'run' || activity === 'walk' ? 'park' : 'village'
}

export function timeFor(prompt: string): WorldTimeOfDay {
  for (const [re, time] of TIMES) if (re.test(prompt)) return time
  return 'day'
}

export function weatherFor(prompt: string, place: WorldPlace): WorldWeather {
  if (/\b(rain\w*|monsoon|storm\w*|drizzle)\b/i.test(prompt)) return 'rain'
  if (/\b(snowing|snowfall|snowstorm|blizzard)\b/i.test(prompt) || (place === 'snow' && /\bsnow\b/i.test(prompt))) return 'snow'
  return 'clear'
}

export function worldActivityFor(prompt: string): WorldActivity {
  switch (activityFor(prompt)) {
    case 'football':
    case 'play':
      return 'football'
    case 'dance':
      return 'dance'
    case 'run':
    case 'fly':
      return 'run'
    case 'jump':
      return 'jump'
    default:
      return 'walk'
  }
}

/** Who the story is about, and who is with them. */
export function castFor(prompt: string, activity: WorldActivity, seed: number): CastMember[] {
  const p = prompt.toLowerCase()
  let hero: CastKind
  if (/\b(girl|daughter|sister)\b/.test(p)) hero = 'girl'
  else if (/\b(boy|son|brother)\b/.test(p)) hero = 'boy'
  else if (/\b(woman|lady|mother|mom|mum|grandma|aunt)\b/.test(p)) hero = 'woman'
  else if (/\b(man|father|dad|farmer|grandpa|uncle|guy)\b/.test(p)) hero = 'man'
  else if (/\b(dog|puppy)\b/.test(p) && !/\b(kids?|child|children|people|friends)\b/.test(p)) hero = 'dog'
  else hero = seed % 2 ? 'girl' : 'boy'
  const adult = hero === 'man' || hero === 'woman'
  const group = /\b(kids|children|friends|team|boys|girls|players|group|family|together)\b/.test(p)
  let friends = activity === 'football' ? 3 : activity === 'dance' || activity === 'jump' ? 2 : group ? 2 : 1
  if (group && activity !== 'football') friends += 1
  const cast: CastMember[] = [{ kind: hero, look: seed % 10_000 }]
  const mix: CastKind[] = adult ? ['man', 'woman'] : hero === 'girl' ? ['girl', 'boy'] : ['boy', 'girl']
  for (let i = 0; i < friends; i++) cast.push({ kind: mix[(i + seed) % 2]!, look: (seed * 7 + 131 * (i + 1)) % 10_000 })
  if (hero !== 'dog' && /\b(dog|puppy)\b/.test(p)) cast.push({ kind: 'dog', look: (seed * 3 + 77) % 10_000 })
  return cast
}

interface Step {
  title: string
  shot: WorldShot
  action: WorldAction
}

/** The arc of each kind of story, in order; shorter videos keep the essential steps. */
const ARCS: Record<WorldActivity, { steps: Step[]; core: string[] }> = {
  football: {
    steps: [
      { title: 'Opening', shot: 'establishing', action: 'dribble' },
      { title: 'Close-up', shot: 'closeup', action: 'idle' },
      { title: 'On the run', shot: 'tracking', action: 'dribble' },
      { title: 'Footwork', shot: 'detail', action: 'dribble' },
      { title: 'Teamwork', shot: 'wide', action: 'dribble' },
      { title: 'From above', shot: 'aerial', action: 'dribble' },
      { title: 'The shot', shot: 'low', action: 'kick' },
      { title: 'Goal!', shot: 'orbit', action: 'celebrate' },
      { title: 'Together', shot: 'wide', action: 'celebrate' },
      { title: 'Finale', shot: 'pullback', action: 'celebrate' },
    ],
    core: ['Opening', 'On the run', 'The shot', 'Goal!', 'Close-up', 'Finale', 'Footwork', 'Teamwork', 'From above', 'Together'],
  },
  dance: {
    steps: [
      { title: 'Opening', shot: 'establishing', action: 'dance' },
      { title: 'Close-up', shot: 'closeup', action: 'dance' },
      { title: 'In the groove', shot: 'orbit', action: 'dance' },
      { title: 'Footwork', shot: 'detail', action: 'dance' },
      { title: 'Everyone dances', shot: 'wide', action: 'dance' },
      { title: 'Big jump', shot: 'low', action: 'jump' },
      { title: 'Finale', shot: 'pullback', action: 'dance' },
    ],
    core: ['Opening', 'In the groove', 'Close-up', 'Big jump', 'Finale', 'Everyone dances', 'Footwork'],
  },
  run: {
    steps: [
      { title: 'Opening', shot: 'establishing', action: 'run' },
      { title: 'Alongside', shot: 'tracking', action: 'run' },
      { title: 'Close-up', shot: 'closeup', action: 'run' },
      { title: 'Footsteps', shot: 'detail', action: 'run' },
      { title: 'From above', shot: 'aerial', action: 'run' },
      { title: 'Leap', shot: 'low', action: 'jump' },
      { title: 'Made it!', shot: 'orbit', action: 'celebrate' },
      { title: 'Finale', shot: 'pullback', action: 'walk' },
    ],
    core: ['Opening', 'Alongside', 'Made it!', 'Close-up', 'Finale', 'Leap', 'Footsteps', 'From above'],
  },
  walk: {
    steps: [
      { title: 'Opening', shot: 'establishing', action: 'walk' },
      { title: 'Close-up', shot: 'closeup', action: 'walk' },
      { title: 'Strolling', shot: 'tracking', action: 'walk' },
      { title: 'Footsteps', shot: 'detail', action: 'walk' },
      { title: 'A pause', shot: 'wide', action: 'idle' },
      { title: 'Hello!', shot: 'orbit', action: 'jump' },
      { title: 'Finale', shot: 'pullback', action: 'walk' },
    ],
    core: ['Opening', 'Strolling', 'Close-up', 'Finale', 'A pause', 'Hello!', 'Footsteps'],
  },
  jump: {
    steps: [
      { title: 'Opening', shot: 'establishing', action: 'jump' },
      { title: 'Close-up', shot: 'closeup', action: 'jump' },
      { title: 'Bouncing', shot: 'orbit', action: 'jump' },
      { title: 'Up high', shot: 'low', action: 'jump' },
      { title: 'Everyone joins', shot: 'wide', action: 'jump' },
      { title: 'Hooray', shot: 'orbit', action: 'celebrate' },
      { title: 'Finale', shot: 'pullback', action: 'jump' },
    ],
    core: ['Opening', 'Bouncing', 'Close-up', 'Hooray', 'Finale', 'Up high', 'Everyone joins'],
  },
}

function lookFor(place: WorldPlace, time: WorldTimeOfDay, weather: WorldWeather, activity: WorldActivity): LookSettings {
  const atmosphere: Atmosphere =
    weather === 'rain' ? 'rain' : weather === 'snow' ? 'snow' : time === 'night' ? 'fireflies' : place === 'village' && activity === 'football' ? 'dust' : 'none'
  return {
    grade: time === 'sunset' ? 'warm' : time === 'night' ? 'cool' : 'vivid',
    atmosphere,
    grain: 0.05,
    vignette: 0.28,
    bloom: time === 'night' ? 0.35 : 0.18,
    letterbox: false,
  }
}

/** Plan a live 3D video of about `length` seconds for a prompt. */
export function planWorld(prompt: string, length: number, seedOverride?: number): WorldPlan {
  const subject = extractSubject(prompt)
  const seed = seedOverride ?? hashString(subject.toLowerCase()) % 100_000
  const activity = worldActivityFor(prompt)
  const place = placeFor(prompt, activity)
  const time = timeFor(prompt)
  const weather = weatherFor(prompt, place)
  const arc = ARCS[activity]
  const count = Math.max(3, Math.min(arc.steps.length, Math.round(length / 4.2)))
  const keep = new Set(arc.core.slice(0, count))
  const steps = arc.steps.filter((s) => keep.has(s.title))
  const duration = Math.max(2.5, Math.round((length / steps.length) * 10) / 10)
  let start = 0
  const shots: WorldShotPlan[] = steps.map((s, i) => {
    const shot: WorldShotPlan = {
      title: s.title,
      shot: s.shot,
      action: s.action,
      start,
      duration,
      // Edited like footage: hard cuts, a fade in from black, a dissolve into the finale.
      transition: i === 0 ? 'fadeBlack' : s.title === 'Finale' ? 'crossfade' : 'none',
    }
    start += duration
    return shot
  })
  const world: WorldSpec = {
    seed,
    place,
    time,
    weather,
    activity,
    cast: castFor(prompt, activity, seed),
    beats: shots.map((s) => ({ action: s.action, duration: s.duration })),
  }
  const title = subject.charAt(0).toUpperCase() + subject.slice(1)
  return { title: title.slice(0, 80), world, shots, look: lookFor(place, time, weather, activity) }
}
