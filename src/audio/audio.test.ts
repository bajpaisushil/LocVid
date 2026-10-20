import { describe, expect, it } from 'vitest'
import { DUCK_LEVEL, type AudioClip } from '@/core/audioPlan'
import { clipEnvelope, envelopeAt } from './envelope'
import { encodeWav } from './wav'

const music: AudioClip = {
  id: 'm',
  assetId: 'a',
  source: 'track',
  role: 'music',
  start: 0,
  offset: 0,
  duration: 10,
  loop: false,
  volume: 0.8,
  fadeIn: 1,
  fadeOut: 2,
  duck: true,
}

describe('gain envelope', () => {
  it('applies fade in and fade out around the volume', () => {
    const env = clipEnvelope({ ...music, duck: false }, [])
    expect(envelopeAt(env, 0)).toBe(0)
    expect(envelopeAt(env, 0.5)).toBeCloseTo(0.4)
    expect(envelopeAt(env, 5)).toBeCloseTo(0.8)
    expect(envelopeAt(env, 9)).toBeCloseTo(0.4)
    expect(envelopeAt(env, 10)).toBe(0)
  })

  it('ducks music under narration with ramps', () => {
    const env = clipEnvelope(music, [{ start: 4, end: 6 }])
    expect(envelopeAt(env, 5)).toBeCloseTo(0.8 * DUCK_LEVEL)
    expect(envelopeAt(env, 2.5)).toBeCloseTo(0.8)
    expect(envelopeAt(env, 7)).toBeCloseTo(0.8)
  })
})

describe('wav encoder', () => {
  it('writes a valid PCM header and samples', async () => {
    const left = new Float32Array([0, 0.5, -1, 1])
    const right = new Float32Array([0, -0.5, 1, -1])
    const blob = encodeWav([left, right], 48000)
    const view = new DataView(await blob.arrayBuffer())
    const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(view.buffer, o, n))
    expect(str(0, 4)).toBe('RIFF')
    expect(str(8, 4)).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2)
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-0x8000) // left[2] = -1
    expect(blob.size).toBe(44 + 16)
  })
})
