import { describe, expect, it } from 'vitest'
import type { WorldShot } from '@/core/types'
import { cameraFor } from './camera'
import { buildChoreography, kickMoment, RATE } from './choreography'
import { planWorld } from './director'
import { celebrate, gait, kick, KICK_CONTACT } from './poses'

describe('3D world director', () => {
  it('turns "a village boy playing" into a football story in a village', () => {
    const plan = planWorld('create video of a village boy playing', 30)
    expect(plan.world.place).toBe('village')
    expect(plan.world.activity).toBe('football')
    expect(plan.world.cast[0]!.kind).toBe('boy')
    expect(plan.world.cast.length).toBeGreaterThanOrEqual(3)
    const actions = plan.shots.map((s) => s.action)
    expect(actions).toContain('kick')
    expect(actions.indexOf('celebrate')).toBeGreaterThan(actions.indexOf('kick'))
    // Shots are continuous: each starts where the previous ended, and the story covers the length.
    plan.shots.forEach((s, i) => {
      if (i > 0) expect(s.start).toBeCloseTo(plan.shots[i - 1]!.start + plan.shots[i - 1]!.duration, 6)
    })
    expect(plan.shots.reduce((t, s) => t + s.duration, 0)).toBeGreaterThan(25)
    expect(new Set(plan.shots.map((s) => s.shot)).size).toBeGreaterThanOrEqual(5)
    // Edited like footage: mostly cuts.
    expect(plan.shots.filter((s) => s.transition === 'none').length).toBeGreaterThanOrEqual(plan.shots.length - 2)
  })

  it('reads place, time, weather, who and what from the words', () => {
    const dance = planWorld('a girl dancing in the park at sunset', 15)
    expect(dance.world).toMatchObject({ place: 'park', time: 'sunset', activity: 'dance' })
    expect(dance.world.cast[0]!.kind).toBe('girl')
    const dog = planWorld('a dog running on the beach', 15)
    expect(dog.world).toMatchObject({ place: 'beach', activity: 'run' })
    expect(dog.world.cast[0]!.kind).toBe('dog')
    expect(planWorld('kids playing football in the snow', 15).world.place).toBe('snow')
    expect(planWorld('a man walking in the city at night in the rain', 15).world).toMatchObject({ place: 'city', time: 'night', weather: 'rain', activity: 'walk' })
  })

  it('is deterministic: the same prompt makes the same video', () => {
    expect(planWorld('a village boy playing', 30)).toEqual(planWorld('a village boy playing', 30))
  })
})

describe('3D choreography', () => {
  const plan = planWorld('create video of a village boy playing', 30)
  const story = buildChoreography(plan.world)

  it('keeps everyone on (or right by) the pitch, moving smoothly', () => {
    let prev = story.frame(0)
    for (let t = 0; t <= story.duration; t += 0.25) {
      const f = story.frame(t)
      for (const a of f.actors) {
        expect(Math.abs(a.x)).toBeLessThan(story.pitch.halfX + 1.5)
        expect(Math.abs(a.z)).toBeLessThan(story.pitch.halfZ + 1.5)
      }
      // No teleports between nearby moments (≤ sprint speed).
      f.actors.forEach((a, i) => expect(Math.hypot(a.x - prev.actors[i]!.x, a.z - prev.actors[i]!.z)).toBeLessThan(0.25 * 6))
      prev = f
    }
  })

  it('dribbles, then shoots: the ball flies toward the goal at the kick', () => {
    const hit = kickMoment(plan.world)!
    expect(hit).toBeGreaterThan(0)
    const before = story.frame(hit - 0.05).ball!
    const after = story.frame(hit + 0.4).ball!
    expect(after.x - before.x).toBeGreaterThan(2)
    expect(Math.max(...[0.1, 0.2, 0.3, 0.4].map((d) => story.frame(hit + d).ball!.y))).toBeGreaterThan(0.4)
  })

  it('celebrates: the hero jumps after the goal', () => {
    const start = plan.shots.find((s) => s.action === 'celebrate')!.start
    const bobs = Array.from({ length: 40 }, (_, i) => story.frame(start + 0.5 + i / 20).actors[0]!.pose.bob)
    expect(Math.max(...bobs)).toBeGreaterThan(0.2)
  })

  it('samples the same moment identically (preview and export agree)', () => {
    const t = 7.37
    expect(story.frame(t)).toEqual(buildChoreography(plan.world).frame(t))
    expect(RATE).toBeGreaterThanOrEqual(60)
  })
})

describe('3D camera rigs', () => {
  const plan = planWorld('create video of a village boy playing', 30)
  const story = buildChoreography(plan.world)
  const shots: WorldShot[] = ['establishing', 'tracking', 'closeup', 'low', 'orbit', 'aerial', 'detail', 'wide', 'pullback']

  it('stay above the ground and inside the clear area, looking near the action', () => {
    for (const shot of shots) {
      for (let t = 0; t < story.duration; t += 1.7) {
        const now = story.frame(t)
        const cam = cameraFor({ shot, progress: (t % 4) / 4, time: t % 4, now, start: story.frame(Math.max(0, t - (t % 4))), pitch: story.pitch, heroHeight: 1.3 })
        expect(cam.position[1]).toBeGreaterThanOrEqual(0.25)
        expect(Math.hypot(cam.position[0], cam.position[2])).toBeLessThanOrEqual(shot === 'aerial' ? 30.01 : 20.01)
        const hero = now.actors[0]!
        expect(Math.hypot(cam.target[0] - hero.x, cam.target[2] - hero.z)).toBeLessThan(shot === 'establishing' || shot === 'wide' ? 12 : 4)
      }
    }
  })

  it('frames close-ups at the face', () => {
    const now = story.frame(6)
    const cam = cameraFor({ shot: 'closeup', progress: 0.5, time: 2, now, start: story.frame(4), pitch: story.pitch, heroHeight: 1.3 })
    expect(cam.target[1]).toBeGreaterThan(1)
    expect(Math.hypot(cam.position[0] - now.actors[0]!.x, cam.position[2] - now.actors[0]!.z)).toBeLessThan(2.6)
  })
})

describe('body animation', () => {
  it('swings legs and arms in opposition', () => {
    const p = gait(Math.PI / 2, 1)
    expect(p.hipL).toBeGreaterThan(0.5)
    expect(p.hipR).toBeLessThan(-0.5)
    expect(Math.sign(p.shoulderL)).toBe(-Math.sign(p.hipL))
  })

  it('kicks through the ball at the contact moment and celebrates with arms up', () => {
    expect(kick(KICK_CONTACT + 0.02, 0).hipR).toBeGreaterThan(0.8)
    expect(kick(0.55, 0).hipR).toBeLessThan(-0.3)
    expect(celebrate(0.3).shoulderL).toBeGreaterThan(2.4)
  })
})
