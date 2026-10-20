import { createId, hashString } from '@/lib/id'
import {
  SCHEMA_VERSION,
  type AspectRatio,
  type AssetMeta,
  type AudioRole,
  type AudioTrack,
  type CinematicSettings,
  type GeneratedBackground,
  type LookSettings,
  type GeneratedStyle,
  type MediaBackground,
  type MotionSettings,
  type Project,
  type Scene,
  type TextOverlay,
  type TextStylePreset,
  type TransitionSettings,
} from './types'

/** Curated gradient palettes for generated backgrounds. */
export const PALETTES: readonly [string, string][] = [
  ['#4f46e5', '#ec4899'],
  ['#0ea5e9', '#22d3ee'],
  ['#f97316', '#e11d48'],
  ['#10b981', '#0d9488'],
  ['#8b5cf6', '#1e1b4b'],
  ['#f59e0b', '#ef4444'],
  ['#0f172a', '#334155'],
  ['#14b8a6', '#6366f1'],
]

export function paletteFor(index: number): [string, string] {
  const p = PALETTES[((index % PALETTES.length) + PALETTES.length) % PALETTES.length]!
  return [p[0], p[1]]
}

export function createGeneratedBackground(
  style: GeneratedStyle = 'linear',
  colors: string[] = paletteFor(0),
  seed = 1,
): GeneratedBackground {
  return { kind: 'generated', style, colors: [...colors], angle: 135, animate: true, seed }
}

export function createMediaBackground(asset: Pick<AssetMeta, 'id' | 'kind'>): MediaBackground {
  return {
    kind: 'media',
    assetId: asset.id,
    fit: 'cover',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    fill: 'blur',
    fillColor: '#000000',
    trimStart: 0,
    volume: asset.kind === 'video' ? 1 : 0,
    loop: true,
  }
}

export function defaultMotion(forKind: 'image' | 'video' | 'generated'): MotionSettings {
  return forKind === 'image'
    ? { preset: 'kenBurns', intensity: 0.5, easing: 'easeInOut' }
    : { preset: 'none', intensity: 0.5, easing: 'easeInOut' }
}

export function defaultCinematic(): CinematicSettings {
  return { enabled: false, camera: 'dollyIn', intensity: 0.5, focus: 'none', animateSky: true, foliage: false, haze: 0 }
}

export function defaultLook(): LookSettings {
  return { grade: 'none', atmosphere: 'none', grain: 0, vignette: 0, bloom: 0, letterbox: false }
}

export function lookIsNeutral(look: LookSettings): boolean {
  return look.grade === 'none' && look.atmosphere === 'none' && look.grain <= 0 && look.vignette <= 0 && look.bloom <= 0 && !look.letterbox
}

export function defaultTransition(isFirst: boolean): TransitionSettings {
  return isFirst ? { type: 'none', duration: 0.6 } : { type: 'crossfade', duration: 0.6 }
}

export interface CreateSceneOptions {
  index?: number
  title?: string
  notes?: string
  duration?: number
  asset?: Pick<AssetMeta, 'id' | 'kind' | 'duration'>
  overlays?: TextOverlay[]
}

export function createScene(options: CreateSceneOptions = {}): Scene {
  const id = createId('scn')
  const index = options.index ?? 0
  const asset = options.asset
  const kind = asset ? (asset.kind === 'video' ? 'video' : 'image') : 'generated'
  const clipDuration = asset?.kind === 'video' && asset.duration ? Math.min(asset.duration, 15) : undefined
  return {
    id,
    title: options.title ?? `Scene ${index + 1}`,
    notes: options.notes ?? '',
    duration: options.duration ?? clipDuration ?? 5,
    background:
      asset && asset.kind !== 'audio'
        ? createMediaBackground(asset)
        : createGeneratedBackground('linear', paletteFor(index), hashString(id)),
    motion: defaultMotion(kind),
    cinematic: defaultCinematic(),
    look: defaultLook(),
    transition: defaultTransition(index === 0),
    overlays: options.overlays ?? [],
    audio: null,
  }
}

type OverlayStyleDefaults = Omit<TextOverlay, 'id' | 'text' | 'start' | 'end'>

const BASE_OVERLAY: OverlayStyleDefaults = {
  style: 'custom',
  x: 0.5,
  y: 0.5,
  maxWidth: 0.86,
  fontFamily: 'inter',
  fontWeight: 700,
  fontSize: 0.075,
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#ffffff',
  align: 'center',
  uppercase: false,
  background: { enabled: false, color: '#000000', opacity: 0.55, padding: 0.35, radius: 0.25 },
  outline: { enabled: false, color: '#000000', width: 0.08 },
  shadow: { enabled: true, color: 'rgba(0,0,0,0.6)', blur: 0.25 },
  animationIn: 'fade',
  animationOut: 'fade',
}

/** Style presets. `fontSize` is a fraction of the frame's short side, so text reads the same in 16:9 and 9:16. */
export function overlayStyleDefaults(style: TextStylePreset, aspect: AspectRatio): OverlayStyleDefaults {
  const vertical = aspect === '9:16'
  switch (style) {
    case 'title':
      return {
        ...BASE_OVERLAY,
        style,
        y: 0.45,
        fontFamily: 'montserrat',
        fontWeight: 800,
        fontSize: 0.11,
        lineHeight: 1.1,
        animationIn: 'slideUp',
      }
    case 'subtitle':
      return { ...BASE_OVERLAY, style, y: 0.6, fontWeight: 600, fontSize: 0.06, color: '#e5e7eb' }
    case 'caption':
      return {
        ...BASE_OVERLAY,
        style,
        y: vertical ? 0.72 : 0.84,
        maxWidth: 0.82,
        fontSize: 0.055,
        background: { ...BASE_OVERLAY.background, enabled: true },
        shadow: { ...BASE_OVERLAY.shadow, enabled: false },
      }
    case 'lowerThird':
      return {
        ...BASE_OVERLAY,
        style,
        x: 0.06,
        y: vertical ? 0.78 : 0.82,
        maxWidth: 0.6,
        align: 'left',
        fontFamily: 'montserrat',
        fontSize: 0.055,
        background: { enabled: true, color: '#7c3aed', opacity: 0.9, padding: 0.4, radius: 0.15 },
        shadow: { ...BASE_OVERLAY.shadow, enabled: false },
        animationIn: 'slideUp',
      }
    case 'quote':
      return {
        ...BASE_OVERLAY,
        style,
        fontFamily: 'playfair',
        fontWeight: 700,
        fontSize: 0.08,
        lineHeight: 1.25,
        animationIn: 'wordByWord',
      }
    case 'custom':
      return { ...BASE_OVERLAY }
  }
}

export function createOverlay(text: string, style: TextStylePreset, aspect: AspectRatio): TextOverlay {
  return { id: createId('txt'), text, start: 0, end: null, ...overlayStyleDefaults(style, aspect) }
}

export function createAudioTrack(
  asset: Pick<AssetMeta, 'id' | 'duration'>,
  role: AudioRole = 'music',
  start = 0,
): AudioTrack {
  return {
    id: createId('aud'),
    assetId: asset.id,
    role,
    start,
    trimStart: 0,
    duration: null,
    volume: role === 'music' ? 0.6 : 1,
    fadeIn: role === 'music' ? 1 : 0,
    fadeOut: role === 'music' ? 2 : 0,
    loop: role === 'music',
    duck: role === 'music',
  }
}

export interface CreateProjectOptions {
  name?: string
  aspectRatio?: AspectRatio
  now?: number
}

export function createProject(options: CreateProjectOptions = {}): Project {
  const now = options.now ?? Date.now()
  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId('prj'),
    name: options.name?.trim() || 'Untitled project',
    aspectRatio: options.aspectRatio ?? '16:9',
    output: { resolution: '720p', fps: 30 },
    scenes: [],
    audioTracks: [],
    assetIds: [],
    brand: { logoAssetId: null, position: 'top-right', size: 0.1, opacity: 0.85 },
    fadeOutEnd: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** Output pixel dimensions for an aspect ratio + preset. Always even (required by H.264 4:2:0). */
export function outputDimensions(aspect: AspectRatio, resolution: '720p' | '1080p'): { width: number; height: number } {
  const short = resolution === '1080p' ? 1080 : 720
  const long = resolution === '1080p' ? 1920 : 1280
  switch (aspect) {
    case '16:9':
      return { width: long, height: short }
    case '9:16':
      return { width: short, height: long }
    case '1:1':
      return { width: short, height: short }
  }
}

export function aspectValue(aspect: AspectRatio): number {
  const { width, height } = outputDimensions(aspect, '720p')
  return width / height
}
