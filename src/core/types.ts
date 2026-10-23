/**
 * Project data model. Everything here is plain, serializable JSON: large media
 * blobs never live in a project — scenes reference assets by stable ID and the
 * blobs are stored separately (see `src/storage`).
 *
 * Spatial values are resolution-independent (fractions of the frame) so the
 * same project renders identically in the small preview and in a 1080p export.
 */

export const SCHEMA_VERSION = 1 as const

/** Hard product limit; long exports exhaust browser memory on typical devices. */
export const MAX_PROJECT_DURATION = 300
export const MIN_SCENE_DURATION = 0.5
export const MAX_SCENE_DURATION = 300
export const MAX_TRANSITION_DURATION = 2

export type AspectRatio = '16:9' | '9:16' | '1:1'
export type ResolutionPreset = '720p' | '1080p'
export type FrameRate = 24 | 25 | 30

export interface OutputSettings {
  resolution: ResolutionPreset
  fps: FrameRate
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type AssetKind = 'image' | 'video' | 'audio'
export type AssetOrigin = 'import' | 'generated' | 'converted'

export interface AssetMeta {
  id: string
  kind: AssetKind
  name: string
  mimeType: string
  /** Bytes. */
  size: number
  /** Display dimensions (after EXIF/rotation metadata) for images and videos. */
  width?: number
  height?: number
  /** Seconds, for video and audio. */
  duration?: number
  /** Whether a video file carries an audio track. */
  hasAudio?: boolean
  /** Content fingerprint used to avoid storing the same file twice. */
  fingerprint: string
  origin: AssetOrigin
  /** Present when an oversized photo was stored downscaled: the original file's size. */
  original?: { width: number; height: number; size: number }
  /** Set for assets produced by a local generator (e.g. an image model). */
  generator?: { model: string; prompt: string }
  createdAt: number
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export type FitMode = 'contain' | 'cover' | 'crop'
export type ContainFill = 'black' | 'blur' | 'color'

/** Normalized (0..1) rectangle in source-media space. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MediaBackground {
  kind: 'media'
  assetId: string
  fit: FitMode
  /** Region of the source shown when `fit === 'crop'`. */
  crop: CropRect
  /** What fills the letterbox when `fit === 'contain'`. */
  fill: ContainFill
  fillColor: string
  /** Video only: offset into the source clip, seconds. */
  trimStart: number
  /** Video only: volume of the clip's own audio (0 = muted). */
  volume: number
  /** Video only: loop the clip when the scene outlasts it. */
  loop: boolean
}

export type GeneratedStyle =
  | 'solid'
  | 'linear'
  | 'radial'
  | 'aurora'
  | 'particles'
  | 'grid'
  | 'waves'
  | 'bokeh'

/** Procedural backgrounds, rendered deterministically from (style, colors, seed, time). */
export interface GeneratedBackground {
  kind: 'generated'
  style: GeneratedStyle
  colors: string[]
  /** Degrees, used by the linear gradient. */
  angle: number
  /** Subtle motion for animated styles. */
  animate: boolean
  seed: number
}

/**
 * Live 3D scenes ("worlds"): a place built procedurally on the device, with
 * characters that actually move — run, dribble, kick, dance — filmed by a
 * virtual camera. Every shot of one video shares the same world and story;
 * each films a different moment of it with its own camera, like an edit of
 * continuous footage.
 */
export type WorldPlace = 'village' | 'park' | 'beach' | 'city' | 'snow'
export type WorldTimeOfDay = 'morning' | 'day' | 'sunset' | 'night'
export type WorldWeather = 'clear' | 'rain' | 'snow'
export type WorldActivity = 'football' | 'run' | 'walk' | 'dance' | 'jump'
export type CastKind = 'boy' | 'girl' | 'man' | 'woman' | 'dog'

export interface CastMember {
  kind: CastKind
  /** Seed for colors and small differences (hair, clothes, height). */
  look: number
}

/** What the hero does next in the story. */
export type WorldAction = 'dribble' | 'run' | 'walk' | 'idle' | 'kick' | 'celebrate' | 'dance' | 'jump'

export interface WorldBeat {
  action: WorldAction
  /** Seconds. */
  duration: number
}

export interface WorldSpec {
  seed: number
  place: WorldPlace
  time: WorldTimeOfDay
  weather: WorldWeather
  activity: WorldActivity
  /** cast[0] is the hero; the rest are friends (and pets) around them. */
  cast: CastMember[]
  /** The hero's story, in order; shots film parts of it. */
  beats: WorldBeat[]
}

export type WorldShot = 'establishing' | 'tracking' | 'closeup' | 'low' | 'orbit' | 'aerial' | 'detail' | 'wide' | 'pullback'

export interface WorldBackground {
  kind: 'world'
  world: WorldSpec
  shot: WorldShot
  /** Seconds into the story where this shot begins. */
  start: number
}

export type SceneBackground = MediaBackground | GeneratedBackground | WorldBackground

export type MotionPreset =
  | 'none'
  | 'zoomIn'
  | 'zoomOut'
  | 'panLeft'
  | 'panRight'
  | 'panUp'
  | 'panDown'
  | 'kenBurns'
  | 'parallax'

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'

export interface MotionSettings {
  preset: MotionPreset
  /** 0..1 — how far the zoom/pan travels. */
  intensity: number
  easing: Easing
}

/** Camera moves for depth-based ("2.5D") cinematic motion. */
export type CameraMove =
  | 'dollyIn'
  | 'dollyOut'
  | 'orbitLeft'
  | 'orbitRight'
  | 'craneUp'
  | 'craneDown'
  | 'truckLeft'
  | 'truckRight'
  | 'float'
  | 'vertigo'

export type FocusMode = 'none' | 'subject' | 'rack'

/**
 * What the cut-out subject (person, animal, object) does during the shot. The
 * subject is separated from a cleaned background plate, so it can move on its
 * own: these are whole-body actions, not limb animation.
 */
export type SubjectAction = 'none' | 'breathe' | 'sway' | 'walk' | 'run' | 'jump' | 'dance' | 'kick' | 'approach' | 'float'

export interface SubjectSettings {
  action: SubjectAction
  /** 0..1 — how big the movement is. */
  amount: number
  /** Which way the subject faces / travels. */
  direction: 'left' | 'right'
}

/** 3D elements added to a cinematic shot, placed in its depth and occluded by it. */
export type PropKind = 'football' | 'birds' | 'balloons' | 'butterflies' | 'confetti' | 'petals' | 'leaves' | 'lanterns'

/**
 * Cinematic 3D motion for photo backgrounds: an on-device depth model turns
 * the still into a depth map, and a WebGL renderer moves a virtual camera
 * through it with real parallax and occlusion.
 */
export interface CinematicSettings {
  enabled: boolean
  camera: CameraMove
  /** 0..1 — how far the camera travels. */
  intensity: number
  focus: FocusMode
  /** Slow drift of the farthest region (sky, distant water). */
  animateSky: boolean
  /** Gentle sway of vegetation. */
  foliage: boolean
  /** 0..1 atmospheric depth haze. */
  haze: number
  /** Subject animation (needs the on-device cut-out of the picture). */
  subject: SubjectSettings
  props: PropKind[]
}

export type Atmosphere = 'none' | 'dust' | 'snow' | 'rain' | 'fireflies' | 'embers' | 'sparkles'
export type GradePreset = 'none' | 'cinematic' | 'warm' | 'cool' | 'vivid' | 'noir' | 'vintage' | 'dreamy'

/** Film look applied to a scene's picture (below its text): grade, particles, lens. */
export interface LookSettings {
  grade: GradePreset
  atmosphere: Atmosphere
  grain: number
  vignette: number
  bloom: number
  letterbox: boolean
}

export type TransitionType =
  | 'none'
  | 'crossfade'
  | 'fadeBlack'
  | 'fadeWhite'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'wipeLeft'
  | 'wipeRight'
  | 'zoom'

/** Transition *into* a scene from the previous one (first scene: fade in from black). */
export interface TransitionSettings {
  type: TransitionType
  /** Seconds; centered on the cut so total duration is unaffected. */
  duration: number
}

export type TextAlign = 'left' | 'center' | 'right'
export type TextAnimation = 'none' | 'fade' | 'slideUp' | 'slideDown' | 'pop' | 'typewriter' | 'wordByWord'
export type TextStylePreset = 'title' | 'subtitle' | 'caption' | 'lowerThird' | 'quote' | 'custom'

export interface TextOverlay {
  id: string
  text: string
  style: TextStylePreset
  /** Anchor x (0..1). Left/center/right edge of the block depending on `align`. */
  x: number
  /** Vertical center of the text block (0..1). */
  y: number
  /** Wrap width as a fraction of frame width. */
  maxWidth: number
  fontFamily: string
  fontWeight: number
  /** Fraction of frame height. */
  fontSize: number
  lineHeight: number
  /** Extra tracking in em. */
  letterSpacing: number
  color: string
  align: TextAlign
  uppercase: boolean
  background: { enabled: boolean; color: string; opacity: number; padding: number; radius: number }
  outline: { enabled: boolean; color: string; width: number }
  shadow: { enabled: boolean; color: string; blur: number }
  animationIn: TextAnimation
  animationOut: TextAnimation
  /** Seconds from scene start. */
  start: number
  /** Seconds from scene start; null = until the scene ends. */
  end: number | null
}

/** A voice-over / sound clip that starts with its scene. */
export interface SceneAudio {
  assetId: string
  volume: number
  /** Delay from scene start, seconds. */
  offset: number
}

export interface Scene {
  id: string
  title: string
  /** Script / narration text for this scene (not rendered unless also an overlay). */
  notes: string
  duration: number
  background: SceneBackground
  motion: MotionSettings
  cinematic: CinematicSettings
  look: LookSettings
  transition: TransitionSettings
  overlays: TextOverlay[]
  audio: SceneAudio | null
}

// ---------------------------------------------------------------------------
// Project-level audio and branding
// ---------------------------------------------------------------------------

export type AudioRole = 'music' | 'narration' | 'sfx'

export interface AudioTrack {
  id: string
  assetId: string
  role: AudioRole
  /** Timeline position, seconds. */
  start: number
  /** Offset into the source, seconds. */
  trimStart: number
  /** Seconds; null = until the source (or the project) ends. */
  duration: number | null
  volume: number
  fadeIn: number
  fadeOut: number
  loop: boolean
  /** Lower this track while scene narration or clip audio plays. */
  duck: boolean
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface BrandSettings {
  logoAssetId: string | null
  position: Corner
  /** Logo height as a fraction of frame height. */
  size: number
  opacity: number
}

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION
  id: string
  name: string
  aspectRatio: AspectRatio
  output: OutputSettings
  scenes: Scene[]
  audioTracks: AudioTrack[]
  /** Assets in this project's media bin (stable IDs into the asset store). */
  assetIds: string[]
  brand: BrandSettings
  /** Fade to black over the final N seconds (0 = off). */
  fadeOutEnd: number
  createdAt: number
  updatedAt: number
}
