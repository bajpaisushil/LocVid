import { describe, expect, it } from 'vitest'
import { extractSubject, planVideo } from './promptPlan'

describe('prompt subject extraction', () => {
  it.each([
    ['create a video showing chhota bheem playing football', 'chhota bheem playing football'],
    ['Make a short video about my trip to Goa.', 'my trip to Goa'],
    ['I want a reel of sunset beaches', 'sunset beaches'],
    ['please generate an animation of a robot dancing!', 'a robot dancing'],
    ['A boy playing football in a village', 'A boy playing football in a village'],
    ['video of rain on a window', 'rain on a window'],
  ])('%s → %s', (prompt, subject) => {
    expect(extractSubject(prompt)).toBe(subject)
  })

  it('falls back to the whole prompt rather than returning nothing', () => {
    expect(extractSubject('make a video')).toBe('make a video')
  })
})

describe('shot planning', () => {
  it('plans an opening and a finale around middle shots, matching the target length', () => {
    for (const length of [15, 30, 60]) {
      const plan = planVideo('create a video showing a boy playing football', { length, style: 'cartoon' })
      const total = plan.shots.reduce((t, s) => t + s.duration, 0)
      expect(Math.abs(total - length)).toBeLessThan(1)
      expect(plan.shots[0]!.title).toBe('Opening')
      expect(plan.shots.at(-1)!.title).toBe('Finale')
      expect(plan.shots.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('builds image prompts from the subject, framing and style', () => {
    const plan = planVideo('a cozy coffee shop', { length: 15, style: 'watercolor' })
    expect(plan.subject).toBe('a cozy coffee shop')
    expect(plan.shots[0]!.imagePrompt).toBe('wide establishing shot of a cozy coffee shop, watercolor painting, soft colors, paper texture')
    expect(plan.shots[1]!.imagePrompt).toContain('close-up portrait of a cozy coffee shop')
    expect(plan.shots[0]!.caption).toBe('A Cozy Coffee Shop')
    expect(plan.shots[0]!.transition).toBe('fadeBlack')
  })

  it('is deterministic', () => {
    expect(planVideo('rain on a window', { length: 30, style: 'photo' })).toEqual(planVideo('rain on a window', { length: 30, style: 'photo' }))
  })
})
