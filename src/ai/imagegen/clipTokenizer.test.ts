import { describe, expect, it } from 'vitest'
import { BOS, ClipTokenizer, EOS } from './clipTokenizer'

// A tiny vocabulary that exercises merges, end-of-word markers and unknown pieces.
// (The real tokenizer was verified against Hugging Face's CLIPTokenizer on the
// SD-Turbo vocab: identical ids for prompts with emoji, CJK, accents and punctuation.)
const vocab = {
  'c': 1, 'a': 2, 't': 3, 'c</w>': 4, 'a</w>': 5, 't</w>': 6,
  'ca': 7, 'cat</w>': 8, 'at</w>': 9, ',</w>': 10, 'd': 11, 'o': 12, 'g</w>': 13, 'do': 14, 'dog</w>': 15,
}
const merges = ['#version: 0.2', 'c a', 'a t</w>', 'ca t</w>', 'd o', 'do g</w>'].join('\n')

describe('CLIP tokenizer', () => {
  const tok = new ClipTokenizer(vocab, merges)

  it('applies BPE merges by rank to whole words', () => {
    expect(tok.encode('cat')).toEqual([8])
    expect(tok.encode('dog')).toEqual([15])
  })

  it('lowercases, collapses whitespace and splits punctuation', () => {
    expect(tok.encode('  CAT,\n\tDog ')).toEqual([8, 10, 15])
  })

  it('maps "!" to the pad id like the reference tokenizer', () => {
    expect(tok.encode('cat!dog')).toEqual([8, 0, 15])
  })

  it('wraps with BOS/EOS, pads and truncates to the model length', () => {
    const ids = tok.inputIds('cat dog', 6)
    expect([...ids]).toEqual([BOS, 8, 15, EOS, 0, 0])
    const long = tok.inputIds('cat '.repeat(10), 5)
    expect([...long]).toEqual([BOS, 8, 8, 8, EOS])
  })
})
