import { describe, expect, it } from 'vitest'
import { activityFor, atmosphereForPrompt, directShot, directSubject, facingFor, framingCrop, lookForStyle, propsForShot, subjectKind } from './direction'
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

  it('reads what the subject does and what it is from the prompt', () => {
    expect(activityFor('create a video showing chhota bheem playing football')).toBe('football')
    expect(activityFor('a girl dancing in a flower garden')).toBe('dance')
    expect(activityFor('a dog running on the beach')).toBe('run')
    expect(activityFor('a lighthouse at sunset')).toBe('still')
    expect(subjectKind('a boy in a village')).toBe('person')
    expect(subjectKind('a golden retriever dog')).toBe('animal')
    expect(subjectKind('a lighthouse on a cliff')).toBe('object')
    expect(subjectKind('chhota bheem')).toBe('unknown')
  })

  it('animates the subject per shot: run, kick, celebrate — and never makes a lighthouse walk', () => {
    const prompt = 'chhota bheem playing football in a village'
    expect(directSubject(prompt, 'In action')).toMatchObject({ action: 'run', framing: 'full' })
    expect(directSubject(prompt, 'The moment').action).toBe('kick')
    expect(directSubject(prompt, 'Celebration').action).toBe('jump')
    expect(directSubject(prompt, 'Close-up').framing).toBeUndefined()
    expect(directSubject('a lighthouse at sunset', 'In action').action).toBe('none')
    expect(directSubject('a woman on a beach', 'Opening').action).toBe('breathe')
  })

  it('adds props that fit the words, at most two per shot', () => {
    const prompt = 'a boy scoring a winning goal in a village football match'
    expect(propsForShot(prompt, 'The moment', 'kick')).toContain('football')
    expect(propsForShot(prompt, 'Celebration', 'jump')).toContain('confetti')
    expect(propsForShot(prompt, 'Opening', 'breathe')).toEqual(['football', 'birds'])
    expect(propsForShot('a birthday party', 'Celebration', 'jump')).toEqual(['confetti', 'balloons'])
    expect(propsForShot('a quiet library', 'Opening', 'breathe')).toEqual([])
  })

  it('frames wide shots to keep the head in view, and full shots around the whole subject', () => {
    // A tall standing figure in a square picture, shown in 16:9 (only 56% of the height fits).
    const tall: [number, number, number, number] = [0.4, 0.08, 0.2, 0.88]
    const wide = framingCrop('wide', tall, 1024, 1024, 16 / 9)!
    expect(wide.y).toBeLessThanOrEqual(0.08)
    // A smaller figure: the full framing contains all of it.
    const small: [number, number, number, number] = [0.3, 0.45, 0.12, 0.3]
    const full = framingCrop('full', small, 2048, 2048, 16 / 9)!
    expect(full.x).toBeLessThanOrEqual(0.3)
    expect(full.y).toBeLessThanOrEqual(0.45)
    expect(full.x + full.width).toBeGreaterThanOrEqual(0.42)
    expect(full.y + full.height).toBeGreaterThanOrEqual(0.75)
    expect(full.width).toBeLessThan(1)
  })

  it('faces the subject toward the roomier side of the frame', () => {
    expect(facingFor([0.1, 0.3, 0.2, 0.5], null)).toBe('right')
    expect(facingFor([0.7, 0.3, 0.2, 0.5], null)).toBe('left')
  })
})
