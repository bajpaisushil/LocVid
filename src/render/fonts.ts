import bebas400 from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url'
import bebasExt400 from '@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff2?url'
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url'
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url'
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url'
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff2?url'
import interExt400 from '@fontsource/inter/files/inter-latin-ext-400-normal.woff2?url'
import interExt600 from '@fontsource/inter/files/inter-latin-ext-600-normal.woff2?url'
import interExt700 from '@fontsource/inter/files/inter-latin-ext-700-normal.woff2?url'
import interExt800 from '@fontsource/inter/files/inter-latin-ext-800-normal.woff2?url'
import marker400 from '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url'
import mont500 from '@fontsource/montserrat/files/montserrat-latin-500-normal.woff2?url'
import mont700 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2?url'
import mont800 from '@fontsource/montserrat/files/montserrat-latin-800-normal.woff2?url'
import mont900 from '@fontsource/montserrat/files/montserrat-latin-900-normal.woff2?url'
import montExt500 from '@fontsource/montserrat/files/montserrat-latin-ext-500-normal.woff2?url'
import montExt700 from '@fontsource/montserrat/files/montserrat-latin-ext-700-normal.woff2?url'
import montExt800 from '@fontsource/montserrat/files/montserrat-latin-ext-800-normal.woff2?url'
import montExt900 from '@fontsource/montserrat/files/montserrat-latin-ext-900-normal.woff2?url'
import playfair400 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2?url'
import playfair700 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2?url'
import playfairExt400 from '@fontsource/playfair-display/files/playfair-display-latin-ext-400-normal.woff2?url'
import playfairExt700 from '@fontsource/playfair-display/files/playfair-display-latin-ext-700-normal.woff2?url'

/**
 * Fonts bundled with the app (all SIL Open Font License) and served from the
 * app's own origin — no font CDN. They are registered through the FontFace API
 * under private family names so preview (main thread) and export (worker)
 * render text with exactly the same files. Scripts these fonts don't cover
 * (e.g. Devanagari, CJK) fall back to the system's fonts.
 */

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'

interface FaceSource {
  weight: number
  url: string
  unicodeRange: string
}

export interface FontDef {
  id: string
  label: string
  /** Private family name used for rendering. */
  family: string
  weights: number[]
  fallback: string
  faces: FaceSource[]
}

const faces = (pairs: [number, string, string | null][]): FaceSource[] =>
  pairs.flatMap(([weight, latin, ext]) => [
    { weight, url: latin, unicodeRange: LATIN },
    ...(ext ? [{ weight, url: ext, unicodeRange: LATIN_EXT }] : []),
  ])

export const FONTS: FontDef[] = [
  {
    id: 'inter',
    label: 'Inter',
    family: 'LocVid Inter',
    weights: [400, 600, 700, 800],
    fallback: 'system-ui, sans-serif',
    faces: faces([
      [400, inter400, interExt400],
      [600, inter600, interExt600],
      [700, inter700, interExt700],
      [800, inter800, interExt800],
    ]),
  },
  {
    id: 'montserrat',
    label: 'Montserrat',
    family: 'LocVid Montserrat',
    weights: [500, 700, 800, 900],
    fallback: 'system-ui, sans-serif',
    faces: faces([
      [500, mont500, montExt500],
      [700, mont700, montExt700],
      [800, mont800, montExt800],
      [900, mont900, montExt900],
    ]),
  },
  {
    id: 'bebas',
    label: 'Bebas Neue',
    family: 'LocVid Bebas Neue',
    weights: [400],
    fallback: 'Impact, sans-serif',
    faces: faces([[400, bebas400, bebasExt400]]),
  },
  {
    id: 'playfair',
    label: 'Playfair Display',
    family: 'LocVid Playfair',
    weights: [400, 700],
    fallback: 'Georgia, serif',
    faces: faces([
      [400, playfair400, playfairExt400],
      [700, playfair700, playfairExt700],
    ]),
  },
  {
    id: 'marker',
    label: 'Permanent Marker',
    family: 'LocVid Marker',
    weights: [400],
    fallback: 'cursive',
    faces: faces([[400, marker400, null]]),
  },
  {
    id: 'system',
    label: 'System (all languages)',
    family: 'system-ui',
    weights: [400, 700],
    fallback: '-apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
    faces: [],
  },
]

const BY_ID = new Map(FONTS.map((f) => [f.id, f]))

export function resolveFont(id: string): FontDef {
  return BY_ID.get(id) ?? FONTS[0]!
}

/** Closest bundled weight, so the browser never synthesizes a fake bold. */
export function resolveWeight(font: FontDef, weight: number): number {
  let best = font.weights[0]!
  for (const w of font.weights) if (Math.abs(w - weight) < Math.abs(best - weight)) best = w
  return best
}

export function canvasFont(fontId: string, weight: number, sizePx: number): string {
  const font = resolveFont(fontId)
  const family = font.faces.length ? `"${font.family}", ${font.fallback}` : font.fallback
  return `${resolveWeight(font, weight)} ${Math.max(1, sizePx).toFixed(2)}px ${family}`
}

type FontSet = FontFaceSet & { add(face: FontFace): FontFaceSet }

const registered = new WeakMap<object, Map<string, FontFace>>()

function fontSetFor(scope: unknown): FontSet | null {
  const fonts = (scope as { fonts?: FontSet }).fonts
  return fonts && typeof fonts.add === 'function' ? fonts : null
}

/**
 * Register (and load) the faces needed for the given font usages in the
 * current global scope — `document.fonts` on the main thread, `self.fonts`
 * in workers. Resolves once the files are ready; failures fall back silently
 * to system fonts rather than blocking rendering.
 */
export async function loadFonts(usages: { fontId: string; weight: number }[], scope: unknown = globalThis): Promise<void> {
  const set = fontSetFor(scope)
  if (!set || typeof FontFace === 'undefined') return
  let map = registered.get(set)
  if (!map) {
    map = new Map()
    registered.set(set, map)
  }
  const pending: Promise<unknown>[] = []
  for (const usage of usages) {
    const font = resolveFont(usage.fontId)
    const weight = resolveWeight(font, usage.weight)
    for (const face of font.faces.filter((f) => f.weight === weight)) {
      const key = `${font.family}|${face.url}`
      let fontFace = map.get(key)
      if (!fontFace) {
        fontFace = new FontFace(font.family, `url(${JSON.stringify(new URL(face.url, import.meta.url).href)})`, {
          weight: String(weight),
          style: 'normal',
          unicodeRange: face.unicodeRange,
        })
        set.add(fontFace)
        map.set(key, fontFace)
      }
      if (fontFace.status !== 'loaded') pending.push(fontFace.load().catch(() => undefined))
    }
  }
  await Promise.all(pending)
}

/** Every font usage in a project's text overlays. */
export function fontUsages(project: { scenes: { overlays: { fontFamily: string; fontWeight: number }[] }[] }) {
  const seen = new Map<string, { fontId: string; weight: number }>()
  for (const scene of project.scenes) {
    for (const o of scene.overlays) seen.set(`${o.fontFamily}|${o.fontWeight}`, { fontId: o.fontFamily, weight: o.fontWeight })
  }
  return [...seen.values()]
}
