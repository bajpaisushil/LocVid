import { z } from 'zod'
import { clamp } from '@/lib/math'
import {
  MAX_SCENE_DURATION,
  MAX_TRANSITION_DURATION,
  MIN_SCENE_DURATION,
  SCHEMA_VERSION,
  type AssetMeta,
  type Project,
  type PropKind,
} from './types'

/**
 * Validation is deliberately forgiving about *leaf values* (an out-of-range
 * number is clamped, an unknown enum falls back to its default) so a slightly
 * damaged or hand-edited file still opens, but strict about *structure*
 * (IDs, scene list, asset references) so genuinely broken data is rejected
 * with a readable error instead of crashing the editor later.
 */

const num = (min: number, max: number, fallback: number) =>
  z
    .number()
    .catch(fallback)
    .transform((v) => clamp(v, min, max))

const bool = (fallback: boolean) => z.boolean().catch(fallback)

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i
const color = (fallback: string) =>
  z
    .string()
    .regex(COLOR_RE)
    .catch(fallback)

const enumOf = <const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.enum(values).catch(fallback)

const id = z.string().min(1).max(128)

const cropSchema = z
  .object({
    x: num(0, 1, 0),
    y: num(0, 1, 0),
    width: num(0.01, 1, 1),
    height: num(0.01, 1, 1),
  })
  .catch({ x: 0, y: 0, width: 1, height: 1 })

const mediaBackgroundSchema = z.object({
  kind: z.literal('media'),
  assetId: id,
  fit: enumOf(['contain', 'cover', 'crop'], 'cover'),
  crop: cropSchema,
  fill: enumOf(['black', 'blur', 'color'], 'blur'),
  fillColor: color('#000000'),
  trimStart: num(0, 24 * 3600, 0),
  volume: num(0, 2, 1),
  loop: bool(true),
})

const generatedBackgroundSchema = z.object({
  kind: z.literal('generated'),
  style: enumOf(['solid', 'linear', 'radial', 'aurora', 'particles', 'grid', 'waves', 'bokeh'], 'linear'),
  colors: z.array(color('#4f46e5')).min(1).max(4).catch(['#4f46e5', '#ec4899']),
  angle: num(-360, 360, 135),
  animate: bool(true),
  seed: z.number().int().catch(1),
})

const castSchema = z.object({
  kind: enumOf(['boy', 'girl', 'man', 'woman', 'dog'], 'boy'),
  look: z.number().int().catch(1),
})

const worldSpecSchema = z.object({
  seed: z.number().int().catch(1),
  place: enumOf(['village', 'park', 'beach', 'city', 'snow'], 'village'),
  time: enumOf(['morning', 'day', 'sunset', 'night'], 'day'),
  weather: enumOf(['clear', 'rain', 'snow'], 'clear'),
  activity: enumOf(['football', 'run', 'walk', 'dance', 'jump'], 'walk'),
  cast: z.array(castSchema).min(1).max(8).catch([{ kind: 'boy', look: 1 }]),
  beats: z
    .array(
      z.object({
        action: enumOf(['dribble', 'run', 'walk', 'idle', 'kick', 'celebrate', 'dance', 'jump'], 'walk'),
        duration: num(0.5, 300, 4),
      }),
    )
    .min(1)
    .max(60)
    .catch([{ action: 'walk', duration: 6 }]),
})

const worldBackgroundSchema = z.object({
  kind: z.literal('world'),
  world: worldSpecSchema,
  shot: enumOf(['establishing', 'tracking', 'closeup', 'low', 'orbit', 'aerial', 'detail', 'wide', 'pullback'], 'wide'),
  start: num(0, 24 * 3600, 0),
})

const backgroundSchema = z.discriminatedUnion('kind', [mediaBackgroundSchema, generatedBackgroundSchema, worldBackgroundSchema])

const motionSchema = z
  .object({
    preset: enumOf(
      ['none', 'zoomIn', 'zoomOut', 'panLeft', 'panRight', 'panUp', 'panDown', 'kenBurns', 'parallax'],
      'none',
    ),
    intensity: num(0, 1, 0.5),
    easing: enumOf(['linear', 'easeIn', 'easeOut', 'easeInOut'], 'easeInOut'),
  })
  .catch({ preset: 'none', intensity: 0.5, easing: 'easeInOut' })

const subjectSchema = z
  .object({
    action: enumOf(['none', 'breathe', 'sway', 'walk', 'run', 'jump', 'dance', 'kick', 'approach', 'float'], 'none'),
    amount: num(0, 1, 0.6),
    direction: enumOf(['left', 'right'], 'right'),
  })
  .catch({ action: 'none', amount: 0.6, direction: 'right' })

const PROP_KINDS = ['football', 'birds', 'balloons', 'butterflies', 'confetti', 'petals', 'leaves', 'lanterns'] as const
const propsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((list) => [...new Set(list.filter((p): p is PropKind => PROP_KINDS.includes(p as PropKind)))].slice(0, PROP_KINDS.length))

const cinematicSchema = z
  .object({
    enabled: bool(false),
    camera: enumOf(
      ['dollyIn', 'dollyOut', 'orbitLeft', 'orbitRight', 'craneUp', 'craneDown', 'truckLeft', 'truckRight', 'float', 'vertigo'],
      'dollyIn',
    ),
    intensity: num(0, 1, 0.5),
    focus: enumOf(['none', 'subject', 'rack'], 'none'),
    animateSky: bool(true),
    foliage: bool(false),
    haze: num(0, 1, 0),
    // Added later: projects saved before subject animation get the defaults.
    subject: subjectSchema,
    props: propsSchema,
  })
  .catch({
    enabled: false,
    camera: 'dollyIn',
    intensity: 0.5,
    focus: 'none',
    animateSky: true,
    foliage: false,
    haze: 0,
    subject: { action: 'none', amount: 0.6, direction: 'right' },
    props: [],
  })

const lookSchema = z
  .object({
    grade: enumOf(['none', 'cinematic', 'warm', 'cool', 'vivid', 'noir', 'vintage', 'dreamy'], 'none'),
    atmosphere: enumOf(['none', 'dust', 'snow', 'rain', 'fireflies', 'embers', 'sparkles'], 'none'),
    grain: num(0, 1, 0),
    vignette: num(0, 1, 0),
    bloom: num(0, 1, 0),
    letterbox: bool(false),
  })
  .catch({ grade: 'none', atmosphere: 'none', grain: 0, vignette: 0, bloom: 0, letterbox: false })

const transitionSchema = z
  .object({
    type: enumOf(
      [
        'none',
        'crossfade',
        'fadeBlack',
        'fadeWhite',
        'slideLeft',
        'slideRight',
        'slideUp',
        'slideDown',
        'wipeLeft',
        'wipeRight',
        'zoom',
      ],
      'none',
    ),
    duration: num(0.1, MAX_TRANSITION_DURATION, 0.6),
  })
  .catch({ type: 'none', duration: 0.6 })

const textAnimation = (fallback: 'none' | 'fade') =>
  enumOf(['none', 'fade', 'slideUp', 'slideDown', 'pop', 'typewriter', 'wordByWord'], fallback)

const overlaySchema = z.object({
  id,
  text: z.string().max(2000).catch(''),
  style: enumOf(['title', 'subtitle', 'caption', 'lowerThird', 'quote', 'custom'], 'custom'),
  x: num(-0.5, 1.5, 0.5),
  y: num(-0.5, 1.5, 0.5),
  maxWidth: num(0.05, 1, 0.86),
  fontFamily: z.string().max(64).catch('inter'),
  fontWeight: num(100, 900, 700),
  fontSize: num(0.01, 0.5, 0.075),
  lineHeight: num(0.8, 3, 1.2),
  letterSpacing: num(-0.2, 1, 0),
  color: color('#ffffff'),
  align: enumOf(['left', 'center', 'right'], 'center'),
  uppercase: bool(false),
  background: z
    .object({
      enabled: bool(false),
      color: color('#000000'),
      opacity: num(0, 1, 0.55),
      padding: num(0, 2, 0.35),
      radius: num(0, 2, 0.25),
    })
    .catch({ enabled: false, color: '#000000', opacity: 0.55, padding: 0.35, radius: 0.25 }),
  outline: z
    .object({ enabled: bool(false), color: color('#000000'), width: num(0, 0.5, 0.08) })
    .catch({ enabled: false, color: '#000000', width: 0.08 }),
  shadow: z
    .object({ enabled: bool(true), color: color('rgba(0,0,0,0.6)'), blur: num(0, 2, 0.25) })
    .catch({ enabled: true, color: 'rgba(0,0,0,0.6)', blur: 0.25 }),
  animationIn: textAnimation('fade'),
  animationOut: textAnimation('fade'),
  start: num(0, MAX_SCENE_DURATION, 0),
  end: z.number().nullable().catch(null),
})

const sceneAudioSchema = z
  .object({ assetId: id, volume: num(0, 2, 1), offset: num(0, MAX_SCENE_DURATION, 0) })
  .nullable()
  .catch(null)

const sceneSchema = z.object({
  id,
  title: z.string().max(200).catch('Scene'),
  notes: z.string().max(20000).catch(''),
  duration: num(MIN_SCENE_DURATION, MAX_SCENE_DURATION, 5),
  background: backgroundSchema,
  motion: motionSchema,
  cinematic: cinematicSchema,
  look: lookSchema,
  transition: transitionSchema,
  overlays: z.array(overlaySchema).max(50),
  audio: sceneAudioSchema,
})

const audioTrackSchema = z.object({
  id,
  assetId: id,
  role: enumOf(['music', 'narration', 'sfx'], 'music'),
  start: num(0, 24 * 3600, 0),
  trimStart: num(0, 24 * 3600, 0),
  duration: z.number().positive().nullable().catch(null),
  volume: num(0, 2, 0.8),
  fadeIn: num(0, 30, 0),
  fadeOut: num(0, 30, 0),
  loop: bool(false),
  duck: bool(false),
})

export const projectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  name: z.string().max(200).catch('Untitled project'),
  aspectRatio: enumOf(['16:9', '9:16', '1:1'], '16:9'),
  output: z
    .object({
      resolution: enumOf(['720p', '1080p'], '720p'),
      fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).catch(30),
    })
    .catch({ resolution: '720p', fps: 30 }),
  scenes: z.array(sceneSchema).max(500),
  audioTracks: z.array(audioTrackSchema).max(50).catch([]),
  assetIds: z.array(id).max(5000),
  brand: z
    .object({
      logoAssetId: id.nullable().catch(null),
      position: enumOf(['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'top-right'),
      size: num(0.02, 0.5, 0.1),
      opacity: num(0, 1, 0.85),
    })
    .catch({ logoAssetId: null, position: 'top-right', size: 0.1, opacity: 0.85 }),
  fadeOutEnd: num(0, 10, 0),
  createdAt: z.number().catch(() => Date.now()),
  updatedAt: z.number().catch(() => Date.now()),
})

export const assetMetaSchema = z.object({
  id,
  kind: z.enum(['image', 'video', 'audio']),
  name: z.string().max(512).catch('Untitled'),
  mimeType: z.string().max(128).catch('application/octet-stream'),
  size: z.number().nonnegative().catch(0),
  width: z.number().positive().optional().catch(undefined),
  height: z.number().positive().optional().catch(undefined),
  duration: z.number().nonnegative().optional().catch(undefined),
  hasAudio: z.boolean().optional().catch(undefined),
  fingerprint: z.string().max(256).catch(''),
  origin: enumOf(['import', 'generated', 'converted'], 'import'),
  original: z
    .object({ width: z.number().positive(), height: z.number().positive(), size: z.number().nonnegative() })
    .optional()
    .catch(undefined),
  generator: z.object({ model: z.string().max(256), prompt: z.string().max(4000) }).optional().catch(undefined),
  createdAt: z.number().catch(() => Date.now()),
})

export class ProjectValidationError extends Error {
  readonly issues: string[]
  constructor(message: string, issues: string[] = []) {
    super(message)
    this.name = 'ProjectValidationError'
    this.issues = issues
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)'
    return `${path}: ${issue.message}`
  })
}

/**
 * Upgrade older on-disk shapes to the current schema. Each step takes the
 * previous version's data and returns the next version's. There is only v1
 * today; the hook exists so future schema changes never strand saved projects.
 */
const MIGRATIONS: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {}

export function migrateProject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProjectValidationError('Project data is not an object.')
  }
  let data = raw as Record<string, unknown>
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : NaN
  if (!Number.isInteger(version) || version < 1) {
    throw new ProjectValidationError('Project file has no valid schema version.')
  }
  if (version > SCHEMA_VERSION) {
    throw new ProjectValidationError(
      `This project was saved by a newer version of LocVid (schema v${version}; this app supports v${SCHEMA_VERSION}).`,
    )
  }
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new ProjectValidationError(`No migration available from schema v${version}.`)
    data = step(data)
    version += 1
    data.schemaVersion = version
  }
  return data
}

/** Validate unknown data (e.g. parsed JSON) into a Project, or throw ProjectValidationError. */
export function parseProject(raw: unknown): Project {
  const migrated = migrateProject(raw)
  const result = projectSchema.safeParse(migrated)
  if (!result.success) {
    const issues = formatIssues(result.error)
    throw new ProjectValidationError(`Project data is invalid: ${issues[0] ?? 'unknown problem'}`, issues)
  }
  return normalizeProject(result.data as Project)
}

export function parseAssetMeta(raw: unknown): AssetMeta {
  const result = assetMetaSchema.safeParse(raw)
  if (!result.success) {
    const issues = formatIssues(result.error)
    throw new ProjectValidationError(`Asset metadata is invalid: ${issues[0] ?? 'unknown problem'}`, issues)
  }
  return result.data as AssetMeta
}

/**
 * Fix cross-field invariants that a per-field schema can't express:
 * unique IDs, overlay end after start, the asset bin containing every
 * referenced asset.
 */
export function normalizeProject(project: Project): Project {
  const seenScenes = new Set<string>()
  for (const scene of project.scenes) {
    if (seenScenes.has(scene.id)) throw new ProjectValidationError(`Duplicate scene id "${scene.id}".`)
    seenScenes.add(scene.id)
    for (const overlay of scene.overlays) {
      if (overlay.end !== null && overlay.end <= overlay.start) overlay.end = null
    }
  }
  const referenced = new Set(project.assetIds)
  const addRef = (assetId: string | null | undefined) => {
    if (assetId && !referenced.has(assetId)) {
      referenced.add(assetId)
      project.assetIds.push(assetId)
    }
  }
  for (const scene of project.scenes) {
    if (scene.background.kind === 'media') addRef(scene.background.assetId)
    addRef(scene.audio?.assetId)
  }
  for (const track of project.audioTracks) addRef(track.assetId)
  addRef(project.brand.logoAssetId)
  project.assetIds = [...new Set(project.assetIds)]
  return project
}

/** Stable JSON serialization of a project (what we store and what "Export project" downloads). */
export function serializeProject(project: Project): string {
  return JSON.stringify(project)
}
