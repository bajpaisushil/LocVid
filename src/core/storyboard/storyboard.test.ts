import { describe, expect, it } from 'vitest'
import { ruleBasedAssistant } from './assistants'
import { chunkScript, generateRuleBased, looksLikeTopic, matchImages, suggestDuration } from './rules'
import { fileNameTokens, keywords, parseBlocks, splitSentences, stem, suggestTitle } from './text'
import { DEFAULT_STORYBOARD_OPTIONS, type DraftScene } from './types'

const opts = DEFAULT_STORYBOARD_OPTIONS

describe('script parsing', () => {
  it('splits paragraphs and attaches headings', () => {
    const blocks = parseBlocks('# Intro\nWelcome to the show.\n\n## Part two\nMore things\nhappen here.\n\nPlain paragraph.')
    expect(blocks).toEqual([
      { heading: 'Intro', text: 'Welcome to the show.' },
      { heading: 'Part two', text: 'More things happen here.' },
      { heading: null, text: 'Plain paragraph.' },
    ])
  })

  it('recognizes "Scene 1:" style headings and bullet lists', () => {
    const blocks = parseBlocks('Scene 1: The beach\n- Waves roll in.\n- Birds fly.\n\nSCENE 2 - Night')
    expect(blocks[0]).toEqual({ heading: 'The beach', text: 'Waves roll in. Birds fly.' })
    expect(blocks[1]).toEqual({ heading: 'Night', text: '' })
  })

  it('handles Windows line endings', () => {
    expect(parseBlocks('One.\r\n\r\nTwo.')).toHaveLength(2)
  })
})

describe('sentence splitting', () => {
  it('splits on terminal punctuation', () => {
    expect(splitSentences('Hello there. How are you? Great!')).toEqual(['Hello there.', 'How are you?', 'Great!'])
  })

  it('keeps abbreviations, initials and decimals intact', () => {
    expect(splitSentences('Dr. Smith paid $3.50 at 5 p.m. today. Then J. R. R. Tolkien arrived.')).toEqual([
      'Dr. Smith paid $3.50 at 5 p.m. today.',
      'Then J. R. R. Tolkien arrived.',
    ])
  })

  it('keeps closing quotes with their sentence', () => {
    expect(splitSentences('She said "go." We went.')).toEqual(['She said "go."', 'We went.'])
  })

  it('returns trailing text without punctuation', () => {
    expect(splitSentences('No punctuation here')).toEqual(['No punctuation here'])
  })
})

describe('keywords and titles', () => {
  it('extracts content words without stopwords', () => {
    expect(keywords('The beach at sunset is the best beach in the world')).toEqual(['beach', 'sunset', 'world'])
  })

  it('stems plurals and gerunds', () => {
    expect(stem('beaches')).toBe('beach')
    expect(stem('cities')).toBe('city')
    expect(stem('running')).toBe('run')
    expect(stem('dogs')).toBe('dog')
    expect(stem('glass')).toBe('glass')
  })

  it('tokenizes file names, dropping camera noise', () => {
    expect(fileNameTokens('Beach_Sunset-02.jpg')).toEqual(['beach', 'sunset'])
    expect(fileNameTokens('IMG_1234.JPG')).toEqual([])
    expect(fileNameTokens('mountainLakeView.png')).toEqual(['mountain', 'lake', 'view'])
  })

  it('suggests short titles', () => {
    expect(suggestTitle('Coffee is the most popular drink in the world, by far.')).toBe('Coffee is the most popular drink…')
    expect(suggestTitle('Short one.')).toBe('Short one')
  })
})

describe('durations', () => {
  it('derives duration from reading speed within limits', () => {
    expect(suggestDuration(25, opts)).toBe(10.8)
    expect(suggestDuration(1, opts)).toBe(2.5)
    expect(suggestDuration(500, opts)).toBe(12)
  })
})

describe('chunking', () => {
  it('uses paragraphs when there are several', () => {
    const chunks = chunkScript('First idea here.\n\nSecond idea follows.\n\nThird idea ends it.', opts)
    expect(chunks.map((c) => c.text)).toEqual(['First idea here.', 'Second idea follows.', 'Third idea ends it.'])
  })

  it('splits one long paragraph into sentence groups that fit the maximum length', () => {
    const sentence = 'This sentence has exactly eight words in it. '
    const chunks = chunkScript(sentence.repeat(10), opts)
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(suggestDuration(c.text.split(/\s+/).length, opts)).toBeLessThanOrEqual(12)
  })

  it('sentence mode makes one scene per sentence and folds tiny ones', () => {
    const chunks = chunkScript('Wow. This is the first real sentence. And this is another one here.', { ...opts, split: 'sentences' })
    expect(chunks.map((c) => c.text)).toEqual(['Wow. This is the first real sentence.', 'And this is another one here.'])
  })
})

describe('rule-based storyboard', () => {
  const script = `# Morning
The sun rises over the quiet beach.

## Afternoon
We hike up the mountain trail and see the lake.

Evening falls and the city lights come on.`

  it('builds scenes with titles, captions, durations and notes', async () => {
    const draft = await ruleBasedAssistant.generate({ text: script, options: opts, images: [] })
    expect(draft.source).toBe('rules')
    expect(draft.scenes.map((s) => s.title)).toEqual(['Morning', 'Afternoon', 'Evening falls and the city lights…'])
    expect(draft.scenes[0]!.caption).toBe('The sun rises over the quiet beach.')
    expect(draft.scenes[0]!.narration).toBe('The sun rises over the quiet beach.')
    expect(draft.scenes.every((s) => s.duration >= 2.5 && s.duration <= 12)).toBe(true)
    expect(draft.notes.join(' ')).toMatch(/150 words per minute/)
  })

  it('matches images by file name, then fills in order', () => {
    const draft = generateRuleBased({
      text: script,
      options: opts,
      images: [
        { id: 'a', name: 'IMG_0001.jpg' },
        { id: 'b', name: 'mountain-lake.jpg' },
        { id: 'c', name: 'beach_sunrise.png' },
      ],
    })
    expect(draft.scenes.map((s) => s.imageId)).toEqual(['c', 'b', 'a'])
    expect(draft.scenes[0]!.imageReason).toMatch(/File name matches/)
    expect(draft.scenes[2]!.imageReason).toBe('Next unused image')
  })

  it('leaves scenes without images when there are not enough (unless reuse is on)', () => {
    const scenes: DraftScene[] = [1, 2, 3].map((i) => ({
      title: `S${i}`,
      narration: '',
      caption: '',
      duration: 3,
      keywords: [],
      imageId: null,
      imageReason: null,
      isTitleCard: false,
    }))
    matchImages(scenes, [{ id: 'only', name: 'x.jpg' }], false)
    expect(scenes.map((s) => s.imageId)).toEqual(['only', null, null])
    const again = scenes.map((s) => ({ ...s, imageId: null, imageReason: null }))
    matchImages(again, [{ id: 'only', name: 'x.jpg' }], true)
    expect(again.map((s) => s.imageId)).toEqual(['only', 'only', 'only'])
  })

  it('treats a short phrase as a topic and returns a labelled outline template', () => {
    expect(looksLikeTopic('5 tips for better sleep')).toBe(true)
    expect(looksLikeTopic('Sleep matters. Here is why.')).toBe(false)
    const draft = generateRuleBased({ text: '5 tips for better sleep', options: opts, images: [] })
    expect(draft.scenes[0]!.title).toBe('5 tips for better sleep')
    expect(draft.scenes[0]!.isTitleCard).toBe(true)
    expect(draft.scenes.length).toBe(7)
    expect(draft.notes[0]).toMatch(/outline template/)
  })

  it('returns nothing for empty input', () => {
    expect(generateRuleBased({ text: '   ', options: opts, images: [] }).scenes).toEqual([])
  })

  it('is deterministic', () => {
    const a = generateRuleBased({ text: script, options: opts, images: [] })
    const b = generateRuleBased({ text: script, options: opts, images: [] })
    expect(a).toEqual(b)
  })
})
