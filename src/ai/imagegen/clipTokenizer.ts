/**
 * CLIP byte-level BPE tokenizer (as used by Stable Diffusion's text encoder),
 * ported from OpenAI's `simple_tokenizer.py`. Runs on the vocab.json and
 * merges.txt shipped with the model, so prompts are tokenized locally.
 */

export const BOS = 49406
export const EOS = 49407
/** "!" — the pad token of SD 2.x's tokenizer. */
const SPECIAL_PAD = 0

const PATTERN = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/giu

/** GPT-2/CLIP reversible byte → printable-unicode mapping. */
function bytesToUnicode(): string[] {
  const bs: number[] = []
  for (let i = 33; i <= 126; i++) bs.push(i)
  for (let i = 161; i <= 172; i++) bs.push(i)
  for (let i = 174; i <= 255; i++) bs.push(i)
  const cs = [...bs]
  let n = 0
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b)
      cs.push(256 + n++)
    }
  }
  const table: string[] = Array.from({ length: 256 }, () => '')
  bs.forEach((b, i) => (table[b] = String.fromCharCode(cs[i]!)))
  return table
}

export class ClipTokenizer {
  private readonly encoder: Map<string, number>
  private readonly ranks: Map<string, number>
  private readonly byteEncoder = bytesToUnicode()
  private readonly cache = new Map<string, string[]>()

  constructor(vocab: Record<string, number>, merges: string) {
    this.encoder = new Map(Object.entries(vocab))
    this.ranks = new Map()
    const lines = merges.split('\n')
    let rank = 0
    for (const line of lines) {
      if (!line || line.startsWith('#version')) continue
      const parts = line.trim().split(' ')
      if (parts.length === 2) this.ranks.set(`${parts[0]} ${parts[1]}`, rank++)
    }
  }

  private bpe(token: string): string[] {
    const cached = this.cache.get(token)
    if (cached) return cached
    const chars = [...token]
    let word = [...chars.slice(0, -1), `${chars[chars.length - 1]}</w>`]
    for (;;) {
      let best: [number, number] | null = null
      for (let i = 0; i < word.length - 1; i++) {
        const rank = this.ranks.get(`${word[i]} ${word[i + 1]}`)
        if (rank !== undefined && (!best || rank < best[0])) best = [rank, i]
      }
      if (!best) break
      const first = word[best[1]]!
      const second = word[best[1] + 1]!
      const merged: string[] = []
      for (let i = 0; i < word.length; ) {
        if (i < word.length - 1 && word[i] === first && word[i + 1] === second) {
          merged.push(first + second)
          i += 2
        } else {
          merged.push(word[i]!)
          i += 1
        }
      }
      word = merged
      if (word.length === 1) break
    }
    if (this.cache.size > 5000) this.cache.clear()
    this.cache.set(token, word)
    return word
  }

  /**
   * Token ids for text (no BOS/EOS). Stable Diffusion 2.x registers "!" as a
   * special (padding) token, so — like the reference Hugging Face tokenizer —
   * every "!" in a prompt maps to id 0 rather than being merged by BPE.
   */
  encode(text: string): number[] {
    const clean = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
    const ids: number[] = []
    const utf8 = new TextEncoder()
    clean.split('!').forEach((segment, i) => {
      if (i > 0) ids.push(SPECIAL_PAD)
      for (const match of segment.matchAll(PATTERN)) {
        const mapped = [...utf8.encode(match[0])].map((b) => this.byteEncoder[b]).join('')
        for (const piece of this.bpe(mapped)) {
          const id = this.encoder.get(piece)
          if (id !== undefined) ids.push(id)
        }
      }
    })
    return ids
  }

  /** Model input: [BOS, …tokens (truncated), EOS, pad…] of exactly `length`. */
  inputIds(text: string, length = 77, padId = 0): Int32Array {
    const ids = this.encode(text).slice(0, length - 2)
    const out = new Int32Array(length).fill(padId)
    out[0] = BOS
    out.set(ids, 1)
    out[ids.length + 1] = EOS
    return out
  }
}
