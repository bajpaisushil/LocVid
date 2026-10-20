import { describe, expect, it } from 'vitest'
import { atmosphereForPrompt, directShot, framingCrop, lookForStyle } from './direction'
import { planVideo } from './promptPlan'

describe('shot direction', () => {
  it('gives every planned shot a framing and a distinct-feeling camera move', () => {
    const plan = planVideo('a boy playing football in a village', { length: 30, style: 'cartoon' })
    const directions = plan.shots.map((s, i) => directShot(s.title, i))
    expect(directions[0]!.framing).toBe('wide')
    expect(new Set(directions.map((d) => d.framing)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(directions.map((d) => d.camera)).size).toBeGreaterThanOrEqual(4)
  })

  it('picks atmosphere from the prompt', () => {
    expect(atmosphereForPrompt('kids playing in the snow')).toBe('snow')
    expect(atmosphereForPrompt('a rainy street at night')).toBe('rain')
    expect(atmosphereForPrompt('Diwali lamps glowing')).toBe('embers')
    expect(atmosphereForPrompt('an enchanted forest')).toBe('fireflies')
    expect(atmosphereForPrompt('a birthday party')).toBe('sparkles')
    expect(atmosphereForPrompt('a boy playing football')).toBe('dust')
  })

  it('gives realistic styles a cinema look and keeps cinema bars to landscape', () => {
    expect(lookForStyle('photo', '16:9')).toMatchObject({ grade: 'cinematic', letterbox: true })
    expect(lookForStyle('photo', '9:16').letterbox).toBe(false)
    expect(lookForStyle('cartoon', '16:9').grade).toBe('vivid')
  })

  it('frames close-ups around the subject and leaves wide shots uncropped', () => {
    expect(framingCrop('wide', null, 512, 512, 16 / 9)).toBeNull()
    const close = framingCrop('close', [0.55, 0.3, 0.2, 0.5], 3000, 3000, 16 / 9)!
    expect(close.width).toBeLessThan(0.6)
    const center = close.x + close.width / 2
    expect(center).toBeGreaterThan(0.5)
    expect(close.x + close.width).toBeLessThanOrEqual(1.0000001)
  })

  it('limits magnification for small pictures so close-ups stay sharp', () => {
    const small = framingCrop('close', [0.4, 0.3, 0.2, 0.4], 512, 512, 16 / 9)!
    const big = framingCrop('close', [0.4, 0.3, 0.2, 0.4], 4000, 4000, 16 / 9)!
    expect(small.width).toBeGreaterThan(big.width)
    expect(1 / small.width).toBeLessThanOrEqual(1.26)
  })
})
