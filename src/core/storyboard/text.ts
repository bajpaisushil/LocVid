/**
 * Deterministic text utilities for turning a script into scenes:
 * paragraph/heading detection, sentence splitting, keyword extraction.
 */

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'approx', 'no', 'fig', 'inc', 'ltd', 'co',
  'u.s', 'u.k', 'a.m', 'p.m', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
])

export const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
  can could did do does doing down during each few for from further had has have having he her here hers herself him
  himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or
  other our ours ourselves out over own same she should so some such than that the their theirs them themselves then
  there these they this those through to too under until up very was we were what when where which while who whom why
  will with would you your yours yourself yourselves also get got make made like one two three first next last really
  thing things way many much every new use using used want need know think see look good great best well going go`
    .split(/\s+/)
    .filter(Boolean),
)

export interface ScriptBlock {
  heading: string | null
  text: string
}

const HEADING_RE = /^(?:#{1,6}\s+(.+)|(?:scene|slide|part|chapter)\s*\d*\s*[:.\-–—]\s*(.*))$/i

/** Split a script into paragraphs, attaching markdown/"Scene 1:" headings to the text that follows them. */
export function parseBlocks(script: string): ScriptBlock[] {
  const lines = script.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ScriptBlock[] = []
  let heading: string | null = null
  let buffer: string[] = []
  const flush = () => {
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim()
    if (text) blocks.push({ heading, text })
    else if (heading) blocks.push({ heading, text: '' })
    heading = null
    buffer = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (buffer.length) flush()
      continue
    }
    const m = HEADING_RE.exec(line)
    if (m) {
      if (buffer.length || heading) flush()
      const title = (m[1] ?? m[2] ?? '').trim()
      heading = title || null
      // "Scene 1: Text on the same line" — the rest is the scene's text, not a heading.
      if (m[2] !== undefined && title.split(/\s+/).length > 6) {
        heading = null
        buffer.push(title)
      }
      continue
    }
    buffer.push(line.replace(/^[-*•]\s+/, ''))
  }
  flush()
  return blocks
}

/** Sentence splitter that respects common abbreviations, decimals and initials. */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let start = 0
  const re = /([.!?…]+)(["'”’)\]]*)(\s+|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const end = m.index + m[1]!.length + m[2]!.length
    const before = text.slice(start, m.index)
    const lastWord = /([\p{L}.]+)$/u.exec(before)?.[1]?.toLowerCase() ?? ''
    const next = text.slice(m.index + m[0].length, m.index + m[0].length + 1)
    const isAbbrev = m[1] === '.' && (ABBREVIATIONS.has(lastWord) || /^\p{L}$/u.test(lastWord))
    const nextStartsLower = next !== '' && /\p{Ll}/u.test(next)
    if (isAbbrev || (m[1] === '.' && nextStartsLower)) continue
    const sentence = text.slice(start, end).trim()
    if (sentence) out.push(sentence)
    start = m.index + m[0].length
  }
  const rest = text.slice(start).trim()
  if (rest) out.push(rest)
  return out
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/** Crude English stemmer: enough to match "beaches" with "beach", "running" with "run". */
export function stem(word: string): string {
  let w = word.toLowerCase()
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`
  else if (w.length > 4 && /(sses|shes|ches|xes|zes)$/.test(w)) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2)
  if (w.length > 3 && /(.)\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1)
  return w
}

/** Content words of a text (lowercased, stopwords removed), most frequent first. */
export function keywords(text: string, limit = 8): string[] {
  const counts = new Map<string, number>()
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) {
    const word = raw.replace(/'s$/, '').replace(/'/g, '')
    if (word.length < 3 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([w]) => w)
}

const CAMERA_NOISE = new Set(['img', 'dsc', 'dscn', 'pxl', 'mvimg', 'screenshot', 'photo', 'image', 'pic', 'vid', 'video', 'copy', 'final', 'edited', 'jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'])

/** Words in a file name: "Beach_Sunset-02.jpg" → ["beach", "sunset"]. */
export function fileNameTokens(name: string): string[] {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '')
  return base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !CAMERA_NOISE.has(t) && !STOPWORDS.has(t))
}

/** Short title from the opening words of a chunk. */
export function suggestTitle(text: string, maxWords = 6): string {
  const firstClause = text.split(/[,;:—–]|\s-\s/)[0] ?? text
  const words = firstClause.replace(/["“”‘’]/g, '').trim().split(/\s+/).filter(Boolean)
  let title = words.slice(0, maxWords).join(' ')
  title = title.replace(/[.!?…]+$/, '')
  if (words.length > maxWords) title += '…'
  return title ? title[0]!.toUpperCase() + title.slice(1) : 'Scene'
}
