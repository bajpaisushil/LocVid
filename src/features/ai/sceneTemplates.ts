import { createGeneratedBackground, createOverlay, createScene, paletteFor } from '@/core/defaults'
import type { AspectRatio, GeneratedStyle, Scene } from '@/core/types'
import { hashString } from '@/lib/id'

/**
 * Level-1 "generated scenes": complete designed scenes made from procedural
 * backgrounds, shapes and typography — no model, no download, deterministic.
 */

export interface TemplateField {
  key: string
  label: string
  placeholder: string
  multiline?: boolean
}

export interface SceneTemplate {
  id: string
  name: string
  description: string
  style: GeneratedStyle
  fields: TemplateField[]
  build(values: Record<string, string>, aspect: AspectRatio, index: number): Scene
}

function base(style: GeneratedStyle, index: number, title: string, duration: number, paletteOffset: number): Scene {
  const scene = createScene({ index, title, duration })
  scene.background = createGeneratedBackground(style, paletteFor(index + paletteOffset), hashString(scene.id))
  scene.transition = index === 0 ? { type: 'fadeBlack', duration: 0.6 } : { type: 'crossfade', duration: 0.6 }
  return scene
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: 'title',
    name: 'Title card',
    description: 'Big title and subtitle over a moving aurora.',
    style: 'aurora',
    fields: [
      { key: 'title', label: 'Title', placeholder: 'My summer in Portugal' },
      { key: 'subtitle', label: 'Subtitle', placeholder: 'A travel diary' },
    ],
    build(v, aspect, index) {
      const scene = base('aurora', index, v.title || 'Title card', 4, 4)
      scene.overlays.push(createOverlay(v.title || 'Your title', 'title', aspect))
      if (v.subtitle) scene.overlays.push({ ...createOverlay(v.subtitle, 'subtitle', aspect), start: 0.5 })
      return scene
    },
  },
  {
    id: 'quote',
    name: 'Quote',
    description: 'Serif quote revealed word by word, with attribution.',
    style: 'radial',
    fields: [
      { key: 'quote', label: 'Quote', placeholder: 'The best way out is always through.', multiline: true },
      { key: 'author', label: 'Attribution', placeholder: 'Robert Frost' },
    ],
    build(v, aspect, index) {
      const scene = base('radial', index, 'Quote', 6, 6)
      scene.background = { ...scene.background, colors: ['#1e1b4b', '#020617'] } as Scene['background']
      scene.overlays.push({ ...createOverlay(`“${(v.quote || 'Your quote here.').replace(/^["“]|["”]$/g, '')}”`, 'quote', aspect), y: 0.45 })
      if (v.author) {
        scene.overlays.push({ ...createOverlay(`— ${v.author}`, 'subtitle', aspect), y: 0.72, start: 1.2, color: '#c7d2fe' })
      }
      return scene
    },
  },
  {
    id: 'list',
    name: 'List',
    description: 'A heading and up to five points that appear one by one.',
    style: 'linear',
    fields: [
      { key: 'heading', label: 'Heading', placeholder: '3 things to pack' },
      { key: 'items', label: 'Points (one per line)', placeholder: 'Sunscreen\nCamera\nGood shoes', multiline: true },
    ],
    build(v, aspect, index) {
      const items = (v.items || 'First point\nSecond point\nThird point').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5)
      const scene = base('linear', index, v.heading || 'List', Math.max(4, 2 + items.length * 1.2), 1)
      const heading = createOverlay(v.heading || 'Your heading', 'title', aspect)
      scene.overlays.push({ ...heading, y: 0.2, fontSize: 0.085, animationIn: 'slideDown' })
      items.forEach((item, i) => {
        scene.overlays.push({
          ...createOverlay(`${i + 1}.  ${item}`, 'custom', aspect),
          x: 0.12,
          y: 0.38 + i * (0.5 / Math.max(3, items.length)),
          align: 'left',
          maxWidth: 0.78,
          fontSize: 0.06,
          fontWeight: 600,
          start: 0.6 + i * 0.8,
          animationIn: 'slideUp',
        })
      })
      return scene
    },
  },
  {
    id: 'stat',
    name: 'Big number',
    description: 'A huge statistic with a label — great for facts.',
    style: 'grid',
    fields: [
      { key: 'number', label: 'Number', placeholder: '73%' },
      { key: 'label', label: 'Label', placeholder: 'of people check their phone within an hour of waking' },
    ],
    build(v, aspect, index) {
      const scene = base('grid', index, v.number || 'Statistic', 5, 2)
      scene.overlays.push({ ...createOverlay(v.number || '100%', 'custom', aspect), fontFamily: 'bebas', fontWeight: 400, fontSize: 0.3, y: 0.38, animationIn: 'pop' })
      if (v.label) scene.overlays.push({ ...createOverlay(v.label, 'subtitle', aspect), y: 0.66, maxWidth: 0.75, start: 0.6 })
      return scene
    },
  },
  {
    id: 'outro',
    name: 'Outro',
    description: 'Thank-you message and call to action over floating particles.',
    style: 'particles',
    fields: [
      { key: 'message', label: 'Message', placeholder: 'Thanks for watching!' },
      { key: 'cta', label: 'Call to action', placeholder: 'Subscribe for more' },
    ],
    build(v, aspect, index) {
      const scene = base('particles', index, 'Outro', 4, 3)
      scene.overlays.push(createOverlay(v.message || 'Thanks for watching!', 'title', aspect))
      scene.overlays.push({ ...createOverlay(v.cta || 'Subscribe for more', 'lowerThird', aspect), x: 0.5, align: 'center', y: 0.66, start: 0.8 })
      return scene
    },
  },
]
