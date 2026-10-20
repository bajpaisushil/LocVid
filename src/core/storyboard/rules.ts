import { clamp, roundTo } from '@/lib/math'
import type { DraftScene, ImageCandidate, StoryboardDraft, StoryboardOptions, StoryboardRequest } from './types'
import { countWords, fileNameTokens, keywords, parseBlocks, splitSentences, stem, suggestTitle } from './text'

/**
 * Rule-based storyboard: no model, no network — deterministic text rules.
 * Same input always gives the same storyboard.
 */

/** Seconds to read/narrate `words` at a given pace, plus breathing room, within limits. */
export function suggestDuration(words: number, options: Pick<StoryboardOptions, 'wordsPerMinute' | 'minSeconds' | 'maxSeconds'>): number {
  const seconds = (words / Math.max(60, options.wordsPerMinute)) * 60 + 0.8
  return roundTo(clamp(seconds, options.minSeconds, options.maxSeconds), 1)
}

/** A short input without sentence punctuation is treated as a topic, not a script. */
export function looksLikeTopic(text: string): boolean {
  const trimmed = text.trim()
  return countWords(trimmed) <= 12 && !/[.!?]\s+\S/.test(trimmed) && !trimmed.includes('\n')
}

function groupSentences(sentences: string[], targetWords: number): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let words = 0
  for (const s of sentences) {
    const w = countWords(s)
    if (current.length && words + w > targetWords * 1.35) {
      chunks.push(current.join(' '))
      current = []
      words = 0
    }
    current.push(s)
    words += w
    if (words >= targetWords) {
      chunks.push(current.join(' '))
      current = []
      words = 0
    }
  }
  if (current.length) {
    // Fold a tiny trailing fragment into the previous chunk.
    if (chunks.length && words < targetWords * 0.35) chunks[chunks.length - 1] += ` ${current.join(' ')}`
    else chunks.push(current.join(' '))
  }
  return chunks
}

interface Chunk {
  heading: string | null
  text: string
}

export function chunkScript(text: string, options: StoryboardOptions): Chunk[] {
  const blocks = parseBlocks(text)
  // Words that fit in the maximum scene length at the chosen pace.
  const maxWords = Math.max(6, Math.floor(((options.maxSeconds - 0.8) / 60) * options.wordsPerMinute))
  const targetWords = Math.min(maxWords, Math.max(8, Math.round((options.wordsPerMinute / 60) * 6)))
  const mode = options.split === 'auto' ? (blocks.length >= 2 ? 'paragraphs' : 'sentences') : options.split

  const chunks: Chunk[] = []
  for (const block of blocks) {
    if (!block.text) {
      if (block.heading) chunks.push({ heading: block.heading, text: '' })
      continue
    }
    const sentences = splitSentences(block.text)
    let pieces: string[]
    if (mode === 'sentences') {
      // One sentence per scene, but fold very short sentences into the next one.
      pieces = []
      let carry = ''
      for (const s of sentences) {
        const joined = carry ? `${carry} ${s}` : s
        if (countWords(joined) < 4) carry = joined
        else {
          pieces.push(joined)
          carry = ''
        }
      }
      if (carry) {
        if (pieces.length) pieces[pieces.length - 1] += ` ${carry}`
        else pieces.push(carry)
      }
    } else {
      pieces = countWords(block.text) > maxWords ? groupSentences(sentences, targetWords) : [block.text]
    }
    pieces.forEach((piece, i) => chunks.push({ heading: i === 0 ? block.heading : null, text: piece }))
  }
  return chunks
}

function captionFor(text: string, style: StoryboardOptions['captions']): string {
  if (style === 'none') return ''
  if (style === 'firstSentence') return splitSentences(text)[0] ?? text
  return text
}

/**
 * Match images to scenes by file name words vs. scene keywords; then fill the
 * remaining scenes with unused images in import order. Reports why each
 * image was chosen so the UI can say "matched by file name" honestly.
 */
export function matchImages(scenes: DraftScene[], images: ImageCandidate[], reuse: boolean): void {
  if (images.length === 0) return
  const imageStems = images.map((img) => new Set(fileNameTokens(img.name).map(stem)))
  const pairs: { scene: number; image: number; score: number; word: string }[] = []
  scenes.forEach((scene, si) => {
    const words = [...new Set([...scene.keywords, ...keywords(scene.title, 4)])]
    images.forEach((_, ii) => {
      let score = 0
      let word = ''
      for (const w of words) {
        if (imageStems[ii]!.has(stem(w))) {
          score += 1
          word ||= w
        }
      }
      if (score > 0) pairs.push({ scene: si, image: ii, score, word })
    })
  })
  pairs.sort((a, b) => b.score - a.score || a.scene - b.scene || a.image - b.image)
  const usedImages = new Set<number>()
  for (const p of pairs) {
    const scene = scenes[p.scene]!
    if (scene.imageId || usedImages.has(p.image)) continue
    scene.imageId = images[p.image]!.id
    scene.imageReason = `File name matches “${p.word}”`
    usedImages.add(p.image)
  }
  let cursor = 0
  for (const scene of scenes) {
    if (scene.imageId) continue
    while (cursor < images.length && usedImages.has(cursor)) cursor++
    if (cursor < images.length) {
      scene.imageId = images[cursor]!.id
      scene.imageReason = 'Next unused image'
      usedImages.add(cursor)
      cursor++
    } else if (reuse) {
      const index = scenes.indexOf(scene) % images.length
      scene.imageId = images[index]!.id
      scene.imageReason = 'Reused (more scenes than images)'
    }
  }
}

function topicOutline(topic: string, options: StoryboardOptions): DraftScene[] {
  const t = topic.trim().replace(/[.!?]+$/, '')
  const outline: [string, string, number][] = [
    [t, t, 3.5],
    ['Why it matters', `Why ${t.toLowerCase()} matters — replace this with your hook.`, 5],
    ['Point 1', 'Your first key point about the topic.', 5],
    ['Point 2', 'Your second key point.', 5],
    ['Point 3', 'Your third key point.', 5],
    ['Recap', `The short version of ${t.toLowerCase()}.`, 4.5],
    ['Outro', 'Thanks for watching — follow for more.', 3.5],
  ]
  return outline.map(([title, caption, duration], i) => ({
    title,
    narration: '',
    caption: options.captions === 'none' && i > 0 ? '' : caption,
    duration,
    keywords: keywords(`${t} ${title}`, 6),
    imageId: null,
    imageReason: null,
    isTitleCard: i === 0,
  }))
}

export function generateRuleBased(request: StoryboardRequest): StoryboardDraft {
  const { text, options } = request
  const notes: string[] = []
  let scenes: DraftScene[]
  if (!text.trim()) return { scenes: [], source: 'rules', notes: ['Enter a script or a topic to build a storyboard.'] }
  if (looksLikeTopic(text)) {
    scenes = topicOutline(text, options)
    notes.push('Short input without sentences — treated as a topic. This is a fill-in-the-blanks outline template, not generated writing: replace each caption with your own points.')
  } else {
    scenes = chunkScript(text, options).map((chunk) => {
      const words = countWords(chunk.text)
      return {
        title: chunk.heading ?? suggestTitle(chunk.text),
        narration: chunk.text,
        caption: chunk.text ? captionFor(chunk.text, options.captions) : (chunk.heading ?? ''),
        duration: chunk.text ? suggestDuration(words, options) : 3,
        keywords: keywords(`${chunk.heading ?? ''} ${chunk.text}`),
        imageId: null,
        imageReason: null,
        isTitleCard: !chunk.text,
      }
    })
    const total = scenes.reduce((sum, s) => sum + s.duration, 0)
    notes.push(
      `Split into ${scenes.length} scene${scenes.length === 1 ? '' : 's'} by ${options.split === 'auto' ? 'paragraphs/sentences' : options.split}; durations assume ${options.wordsPerMinute} words per minute (total ${Math.round(total)} s).`,
    )
  }
  if (options.matchImages) {
    matchImages(scenes, request.images, options.reuseImages)
    const matched = scenes.filter((s) => s.imageReason?.startsWith('File name')).length
    if (request.images.length) notes.push(`${matched} scene${matched === 1 ? '' : 's'} matched to images by file name; others use images in import order${options.reuseImages ? '' : ' or a gradient'}.`)
  }
  return { scenes, source: 'rules', notes }
}
