import type { CastKind, WorldAction, WorldSpec } from '@/core/types'
import { createRng } from '@/lib/math'
import { KICK_CONTACT, blendPose, celebrate, dance, gait, hop, idle, keeper, kick, wave, type Pose } from './poses'

/**
 * The story of a world as motion: where every character is, which way it
 * faces, what its body is doing, and where the ball is — for every moment.
 *
 * It is simulated once per story at a fixed step (deterministic: the same
 * spec always gives the same motion) and stored as tracks, so any moment can
 * be sampled exactly — in the live preview, after a seek, or in the export.
 *
 * World units are meters, y up. The action happens on a pitch centered on
 * the origin; the hero attacks the goal at +x.
 */

export const RATE = 60
const DT = 1 / RATE
const BALL_RADIUS = 0.11
const GRAVITY = 9.81

/** Body motions an actor can be in (stored as small ints in the tracks). */
const MOTIONS = ['idle', 'gait', 'kick', 'celebrate', 'hop', 'dance', 'keeper', 'wave'] as const
type Motion = (typeof MOTIONS)[number]
const M = Object.fromEntries(MOTIONS.map((m, i) => [m, i])) as Record<Motion, number>

export interface Pitch {
  halfX: number
  halfZ: number
  /** Goal mouth half-width (m) at x = ±goalX; 0 = no goals. */
  goalHalfWidth: number
  goalX: number
}

export function pitchFor(spec: WorldSpec): Pitch {
  const goals = spec.activity === 'football'
  return { halfX: 14, halfZ: 9, goalHalfWidth: goals ? 1.5 : 0, goalX: 13 }
}

export interface ActorFrame {
  kind: CastKind
  x: number
  z: number
  /** Facing: direction (sin h, cos h) in the xz plane. */
  heading: number
  pose: Pose
  /** Seed for per-actor variation (animation offsets). */
  seed: number
  /** Speed (m/s) and stride phase (radians), for gaits drawn by the renderer (e.g. a dog's trot). */
  speed: number
  phase: number
}

export interface BallFrame {
  x: number
  y: number
  z: number
  /** Orientation quaternion (rolling spin). */
  q: [number, number, number, number]
}

export interface WorldFrame {
  actors: ActorFrame[]
  ball: BallFrame | null
  /** The hero's position and facing smoothed over ~1 s, for steady camera work. */
  smooth: { x: number; z: number; heading: number }
  /** Where the action is (between the hero and the ball), for framing. */
  focus: { x: number; y: number; z: number }
}

interface Track {
  x: Float32Array
  z: Float32Array
  h: Float32Array
  speed: Float32Array
  phase: Float32Array
  motion: Uint8Array
  /** Seconds since the current motion began. */
  mtime: Float32Array
  prev: Uint8Array
  /** Extra per-motion value: kick progress, keeper dive. */
  aux: Float32Array
}

function makeTrack(n: number): Track {
  return {
    x: new Float32Array(n),
    z: new Float32Array(n),
    h: new Float32Array(n),
    speed: new Float32Array(n),
    phase: new Float32Array(n),
    motion: new Uint8Array(n),
    mtime: new Float32Array(n),
    prev: new Uint8Array(n),
    aux: new Float32Array(n),
  }
}

export interface Choreography {
  duration: number
  pitch: Pitch
  frame(t: number): WorldFrame
}

const angleTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Turn `h` toward `target` by at most `rate`·dt. */
function steer(h: number, target: number, rate: number): number {
  const d = wrap(target - h)
  return h + clamp(d, -rate * DT, rate * DT)
}

/** Stride length (m) for a full gait cycle at a speed. */
const strideLength = (speed: number) => 0.9 + 0.32 * speed

const runAmount = (speed: number) => clamp((speed - 1.3) / 2.6, 0, 1)

/** The hero's planned body motion for a beat action. */
function heroMotion(action: WorldAction, speed: number): Motion {
  switch (action) {
    case 'idle':
      return speed > 0.4 ? 'gait' : 'idle'
    case 'kick':
      return 'kick'
    case 'celebrate':
      return 'celebrate'
    case 'dance':
      return 'dance'
    case 'jump':
      return 'hop'
    default:
      return speed > 0.15 ? 'gait' : 'idle'
  }
}

const SPEED: Record<WorldAction, number> = { dribble: 3.0, run: 4.4, walk: 1.25, idle: 0, kick: 2.2, celebrate: 0, dance: 0, jump: 0 }

/** Build (simulate) the choreography for a world's story. */
export function buildChoreography(spec: WorldSpec): Choreography {
  const pitch = pitchFor(spec)
  const beats = spec.beats.length ? spec.beats : [{ action: 'walk' as const, duration: 6 }]
  const starts: number[] = []
  let total = 0
  for (const b of beats) {
    starts.push(total)
    total += Math.max(0.5, b.duration)
  }
  const duration = total
  const n = Math.ceil(duration * RATE) + 2
  const rng = createRng(spec.seed * 7919 + 17)
  const football = spec.activity === 'football'
  const cast = spec.cast.length ? spec.cast : [{ kind: 'boy' as const, look: spec.seed }]

  // Roles: hero, then field friends, then (football with 3+ friends) a goalkeeper; pets follow the hero.
  const roles = cast.map((c, i) => {
    if (i === 0) return 'hero'
    if (c.kind === 'dog') return 'dog'
    const humans = cast.slice(1, i + 1).filter((m) => m.kind !== 'dog').length
    const totalHumans = cast.slice(1).filter((m) => m.kind !== 'dog').length
    if (football && totalHumans >= 3 && humans === totalHumans) return 'keeper'
    return 'friend'
  })
  const tracks = cast.map(() => makeTrack(n))

  // Ball state.
  const ball = { x: 0, y: BALL_RADIUS, z: 0, vx: 0, vy: 0, vz: 0, q: [0, 0, 0, 1] as [number, number, number, number], wx: 0, wz: 0, lastTouch: -10, kicked: -1 }
  const ballX = new Float32Array(football ? n : 0)
  const ballY = new Float32Array(football ? n : 0)
  const ballZ = new Float32Array(football ? n : 0)
  const ballQ = new Float32Array(football ? n * 4 : 0)

  // Initial placement: the hero starts left of center heading roughly toward the goal.
  const hero = { x: -pitch.halfX * 0.45, z: (rng() - 0.5) * 4, h: Math.PI / 2 + (rng() - 0.5) * 0.8, speed: 0, phase: 0 }
  ball.x = hero.x + Math.sin(hero.h) * 0.6
  ball.z = hero.z + Math.cos(hero.h) * 0.6
  const mates = cast.map((_, i) => ({
    x: hero.x - 2 - i * 1.5 + rng() * 2,
    z: hero.z + (i % 2 ? 3 : -3) + (rng() - 0.5) * 2,
    h: Math.PI / 2,
    speed: 0,
    phase: rng() * 6,
    dive: 0,
    motion: M.idle,
    mtime: 0,
    prev: M.idle,
  }))
  const wanderA = rng() * 6
  const wanderB = rng() * 6
  const heroState = { motion: M.idle as number, mtime: 0, prev: M.idle as number }

  for (let k = 0; k < n; k++) {
    const t = k * DT
    let bi = 0
    while (bi < beats.length - 1 && t >= starts[bi + 1]!) bi++
    const beat = beats[bi]!
    const local = t - starts[bi]!
    const beatDur = Math.max(0.5, beat.duration)
    const next = beats[bi + 1]

    // ---- Hero ------------------------------------------------------------
    // Where the hero wants to go: a slow wander, kept on the pitch, aimed at the goal before a kick.
    let plan = Math.PI / 2 + 0.9 * Math.sin(0.23 * t + wanderA) + 0.55 * Math.sin(0.57 * t + wanderB)
    const out = Math.max(Math.abs(hero.x) / (pitch.halfX - 3.5), Math.abs(hero.z) / (pitch.halfZ - 2.5))
    if (out > 0.7) {
      const home = angleTo(hero.x, hero.z, 0, 0)
      plan = plan + wrap(home - plan) * smoothstep(0.7, 1.05, out)
    }
    const toGoal = angleTo(hero.x, hero.z, pitch.goalX, 0)
    if (football && (beat.action === 'kick' || (next?.action === 'kick' && starts[bi + 1]! - t < 3))) plan = toGoal

    let targetSpeed = SPEED[beat.action]
    if (beat.action === 'kick') targetSpeed = local / beatDur < KICK_CONTACT ? SPEED.kick * (1 - smoothstep(0.45, KICK_CONTACT, local / beatDur)) : 0
    // Ease to a stop before standing beats, and keep moving actions from starting abruptly.
    if (next && SPEED[next.action] === 0 && beat.action !== 'kick') targetSpeed *= 1 - smoothstep(beatDur - 0.6, beatDur, local)
    const accel = targetSpeed > hero.speed ? 4 : 6
    hero.speed += clamp(targetSpeed - hero.speed, -accel * DT, accel * DT)

    // While dribbling, chase the ball (it goes where the plan sends it on each touch).
    let face = plan
    const dribbling = football && (beat.action === 'dribble' || beat.action === 'run' || (beat.action === 'kick' && local / beatDur < KICK_CONTACT))
    if (dribbling) {
      const ahead = Math.hypot(ball.x - hero.x, ball.z - hero.z)
      if (ahead > 0.35) face = angleTo(hero.x, hero.z, ball.x + ball.vx * 0.25, ball.z + ball.vz * 0.25)
    }
    if (beat.action === 'celebrate' || beat.action === 'dance' || beat.action === 'jump') face = hero.h
    hero.h = steer(hero.h, face, hero.speed > 0.5 ? 2.6 : 1.6)
    hero.x += Math.sin(hero.h) * hero.speed * DT
    hero.z += Math.cos(hero.h) * hero.speed * DT
    hero.x = clamp(hero.x, -pitch.halfX + 1, pitch.halfX - 1)
    hero.z = clamp(hero.z, -pitch.halfZ + 1, pitch.halfZ - 1)
    hero.phase += ((hero.speed * DT) / strideLength(hero.speed)) * Math.PI * 2

    const motion = M[heroMotion(beat.action, hero.speed)]
    if (motion !== heroState.motion) {
      heroState.prev = heroState.motion
      heroState.motion = motion
      heroState.mtime = 0
    } else heroState.mtime += DT
    const ht = tracks[0]!
    ht.x[k] = hero.x
    ht.z[k] = hero.z
    ht.h[k] = hero.h
    ht.speed[k] = hero.speed
    ht.phase[k] = hero.phase
    ht.motion[k] = heroState.motion
    ht.prev[k] = heroState.prev
    ht.mtime[k] = heroState.motion === M.kick || heroState.motion === M.celebrate || heroState.motion === M.dance || heroState.motion === M.hop ? local : heroState.mtime
    ht.aux[k] = beat.action === 'kick' ? local / beatDur : 0

    // ---- Ball --------------------------------------------------------------
    if (football) {
      const onGround = ball.y <= BALL_RADIUS + 1e-3
      const fx = hero.x + Math.sin(hero.h) * 0.35
      const fz = hero.z + Math.cos(hero.h) * 0.35
      const reach = Math.hypot(ball.x - fx, ball.z - fz)
      const u = local / beatDur
      if (beat.action === 'kick' && u >= 0.45 && u < KICK_CONTACT) {
        // Set the ball up at the kicking foot.
        const tx = hero.x + Math.sin(hero.h) * 0.42 + Math.cos(hero.h) * 0.12
        const tz = hero.z + Math.cos(hero.h) * 0.42 - Math.sin(hero.h) * 0.12
        const pull = 1 - Math.exp(-10 * DT)
        ball.x += (tx - ball.x) * pull
        ball.z += (tz - ball.z) * pull
        ball.y = BALL_RADIUS
        ball.vx = (tx - ball.x) * 4
        ball.vz = (tz - ball.z) * 4
        ball.vy = 0
      } else if (beat.action === 'kick' && u >= KICK_CONTACT && ball.kicked < starts[bi]!) {
        // Strike: a lofted shot at the goal, aimed a little off-center.
        ball.kicked = t
        const aimZ = (rng() - 0.5) * 1.6
        const a = angleTo(ball.x, ball.z, pitch.goalX + 1, aimZ)
        const power = 11.5
        ball.vx = Math.sin(a) * power
        ball.vz = Math.cos(a) * power
        ball.vy = 3.6
      } else if (dribbling && onGround && reach < 0.55 && t - ball.lastTouch > 0.5 && hero.speed > 0.4) {
        // A touch: the ball runs ahead where the plan points.
        const speed = hero.speed * 1.4 + 0.3
        ball.vx = Math.sin(plan) * speed
        ball.vz = Math.cos(plan) * speed
        ball.lastTouch = t
      } else if ((beat.action === 'dribble' || beat.action === 'run') && t - ball.kicked > 2 && Math.hypot(ball.vx, ball.vz) < 0.3 && Math.hypot(ball.x - hero.x, ball.z - hero.z) > 4) {
        // A friend passes it back so the hero can play on.
        const d = Math.hypot(hero.x - ball.x, hero.z - ball.z)
        const v = Math.sqrt(2 * 1.6 * d) * 1.05
        const a = angleTo(ball.x, ball.z, hero.x, hero.z)
        ball.vx = Math.sin(a) * v
        ball.vz = Math.cos(a) * v
        ball.lastTouch = t
      }
      // Physics: gravity, bounces, rolling friction, the goal net.
      ball.vy -= GRAVITY * DT
      ball.x += ball.vx * DT
      ball.y += ball.vy * DT
      ball.z += ball.vz * DT
      if (ball.y < BALL_RADIUS) {
        ball.y = BALL_RADIUS
        ball.vy = Math.abs(ball.vy) > 1.2 ? -ball.vy * 0.48 : 0
      }
      if (ball.y <= BALL_RADIUS + 1e-3) {
        const sp = Math.hypot(ball.vx, ball.vz)
        const slow = Math.max(0, sp - 1.6 * DT)
        const f = sp > 1e-6 ? slow / sp : 0
        ball.vx *= f
        ball.vz *= f
      }
      if (pitch.goalHalfWidth > 0 && ball.x > pitch.goalX && Math.abs(ball.z) < pitch.goalHalfWidth && ball.y < 1.7) {
        const damp = Math.exp(-7 * DT)
        ball.vx *= damp
        ball.vz *= damp
        if (ball.x > pitch.goalX + 1.3) {
          ball.x = pitch.goalX + 1.3
          ball.vx = -Math.abs(ball.vx) * 0.2
        }
      }
      ball.x = clamp(ball.x, -pitch.halfX - 4, pitch.halfX + 4)
      ball.z = clamp(ball.z, -pitch.halfZ - 4, pitch.halfZ + 4)
      // Spin: rolling without slipping on the ground (ω = (vz, 0, -vx) / r); in the air it keeps spinning.
      if (ball.y <= BALL_RADIUS + 1e-3) {
        ball.wx = ball.vz / BALL_RADIUS
        ball.wz = -ball.vx / BALL_RADIUS
      }
      const w = Math.hypot(ball.wx, ball.wz)
      if (w > 1e-6) {
        const half = (w * DT) / 2
        const s = Math.sin(half) / w
        const dq = [ball.wx * s, 0, ball.wz * s, Math.cos(half)] as const
        const [qx, qy, qz, qw] = ball.q
        ball.q = [
          dq[3] * qx + dq[0] * qw + dq[1] * qz - dq[2] * qy,
          dq[3] * qy - dq[0] * qz + dq[1] * qw + dq[2] * qx,
          dq[3] * qz + dq[0] * qy - dq[1] * qx + dq[2] * qw,
          dq[3] * qw - dq[0] * qx - dq[1] * qy - dq[2] * qz,
        ]
        const norm = Math.hypot(...ball.q)
        ball.q = ball.q.map((v) => v / norm) as [number, number, number, number]
      }
      ballX[k] = ball.x
      ballY[k] = ball.y
      ballZ[k] = ball.z
      ballQ.set(ball.q, k * 4)
    }

    // ---- Friends, keeper, pets -----------------------------------------------
    for (let i = 1; i < cast.length; i++) {
      const m = mates[i]!
      const role = roles[i]
      let tx: number
      let tz: number
      let maxSpeed = 3.4
      let want: Motion = 'gait'
      const side = i % 2 ? 1 : -1
      const rank = Math.ceil(i / 2)
      if (role === 'keeper') {
        tx = pitch.goalX - 0.7
        tz = clamp((football ? ball.z : hero.z) * 0.6, -pitch.goalHalfWidth + 0.3, pitch.goalHalfWidth - 0.3)
        maxSpeed = 2
        want = 'keeper'
        const incoming = football && ball.kicked > 0 && t - ball.kicked < 1.2 && ball.vx > 2
        m.dive += ((incoming ? 1 : 0) - m.dive) * (1 - Math.exp(-6 * DT))
      } else if (role === 'dog') {
        tx = hero.x - Math.sin(hero.h) * 1.3 + Math.cos(hero.h) * 0.8
        tz = hero.z - Math.cos(hero.h) * 1.3 - Math.sin(hero.h) * 0.8
        maxSpeed = 5.5
      } else if (beat.action === 'celebrate') {
        // Run in to celebrate with the hero.
        const a = hero.h + Math.PI + side * (0.7 + 0.4 * rank)
        tx = hero.x + Math.sin(a) * (1.3 + 0.5 * rank)
        tz = hero.z + Math.cos(a) * (1.3 + 0.5 * rank)
        maxSpeed = 4.2
        want = 'celebrate'
      } else if (spec.activity === 'dance' || beat.action === 'dance') {
        const a = hero.h + side * (1.2 + 0.5 * rank)
        tx = hero.x + Math.sin(a) * (1.6 + 0.4 * rank)
        tz = hero.z + Math.cos(a) * (1.6 + 0.4 * rank)
        want = 'dance'
      } else if (beat.action === 'jump') {
        const a = hero.h + side * (1.3 + 0.4 * rank)
        tx = hero.x + Math.sin(a) * 1.8
        tz = hero.z + Math.cos(a) * 1.8
        want = 'hop'
      } else if (football) {
        // Support play: spread out around the ball, a little behind it.
        const a = hero.h + Math.PI + side * (0.9 + 0.35 * rank)
        tx = ball.x + Math.sin(a) * (3 + 1.2 * rank)
        tz = ball.z + Math.cos(a) * (3 + 1.2 * rank)
      } else {
        // Keep the hero company: alongside, a step behind.
        const a = hero.h + side * 1.9
        tx = hero.x + Math.sin(a) * (1.2 + 0.5 * rank)
        tz = hero.z + Math.cos(a) * (1.2 + 0.5 * rank)
        maxSpeed = Math.max(1.5, hero.speed * 1.15)
      }
      tx = clamp(tx, -pitch.halfX + 0.8, pitch.halfX + 0.5)
      tz = clamp(tz, -pitch.halfZ + 0.8, pitch.halfZ - 0.8)
      // Keep personal space from the hero and the others.
      for (let j = 0; j < cast.length; j++) {
        if (j === i) continue
        const ox = j === 0 ? hero.x : mates[j]!.x
        const oz = j === 0 ? hero.z : mates[j]!.z
        const d = Math.hypot(m.x - ox, m.z - oz)
        if (d < 1.1 && d > 1e-4) {
          tx += ((m.x - ox) / d) * (1.1 - d) * 2
          tz += ((m.z - oz) / d) * (1.1 - d) * 2
        }
      }
      const dist = Math.hypot(tx - m.x, tz - m.z)
      const target = Math.min(maxSpeed, dist * 1.3)
      const rate = target > m.speed ? 3.5 : 5
      m.speed += clamp(target - m.speed, -rate * DT, rate * DT)
      if (m.speed < 0.05) m.speed = 0
      const lookAt = football ? angleTo(m.x, m.z, ball.x, ball.z) : role === 'dog' ? hero.h : angleTo(m.x, m.z, hero.x, hero.z)
      m.h = steer(m.h, m.speed > 0.6 ? angleTo(m.x, m.z, tx, tz) : lookAt, m.speed > 0.6 ? 3 : 2)
      m.x += Math.sin(m.h) * m.speed * DT
      m.z += Math.cos(m.h) * m.speed * DT
      m.phase += ((m.speed * DT) / strideLength(m.speed)) * Math.PI * 2
      let motionNow: Motion
      if (role === 'keeper') motionNow = 'keeper'
      else if (m.speed > 0.3) motionNow = 'gait'
      else if (want === 'gait') motionNow = role === 'dog' ? 'idle' : football && t - ball.kicked < 2.5 && ball.kicked > 0 ? 'wave' : 'idle'
      else motionNow = want
      const code = M[motionNow]
      if (code !== m.motion) {
        m.prev = m.motion
        m.motion = code
        m.mtime = 0
      } else m.mtime += DT
      const tr = tracks[i]!
      tr.x[k] = m.x
      tr.z[k] = m.z
      tr.h[k] = m.h
      tr.speed[k] = m.speed
      tr.phase[k] = m.phase
      tr.motion[k] = m.motion
      tr.prev[k] = m.prev
      tr.mtime[k] = m.mtime
      tr.aux[k] = m.dive
    }
  }

  // Unwrap headings so interpolation never spins the long way round.
  for (const tr of tracks) {
    for (let k = 1; k < n; k++) tr.h[k] = tr.h[k - 1]! + wrap(tr.h[k]! - tr.h[k - 1]!)
  }
  // A smoothed hero path for the camera (centered moving averages: no lag, no jitter).
  const smoothOf = (src: Float32Array, radius: number) => {
    const out = new Float32Array(n)
    const r = Math.round(radius * RATE)
    let acc = 0
    let count = 0
    for (let k = -r; k < n; k++) {
      const add = k + r
      if (add < n) {
        acc += src[add]!
        count++
      }
      if (k - r - 1 >= 0) {
        acc -= src[k - r - 1]!
        count--
      }
      if (k >= 0) out[k] = acc / count
    }
    return out
  }
  const heroTrack = tracks[0]!
  const sx = smoothOf(heroTrack.x, 0.6)
  const sz = smoothOf(heroTrack.z, 0.6)
  const sh = smoothOf(heroTrack.h, 0.9)

  const seeds = cast.map((c, i) => (c.look % 97) / 97 + i * 0.37)

  return {
    duration,
    pitch,
    frame(time: number): WorldFrame {
      const t = clamp(time, 0, duration)
      const f = t * RATE
      const i0 = Math.min(n - 1, Math.floor(f))
      const i1 = Math.min(n - 1, i0 + 1)
      const w = f - i0
      const lerp = (a: Float32Array) => a[i0]! + (a[i1]! - a[i0]!) * w
      const actors: ActorFrame[] = tracks.map((tr, i) => {
        const motion = MOTIONS[tr.motion[i0]!]!
        const prev = MOTIONS[tr.prev[i0]!]!
        const mtime = tr.mtime[i0]! + w * DT
        const speed = lerp(tr.speed)
        const phase = lerp(tr.phase)
        const aux = lerp(tr.aux)
        const seed = seeds[i]!
        let pose = motionPose(motion, mtime, phase, speed, aux, seed)
        // Blend out of the previous motion over a quarter second.
        if (mtime < 0.25 && prev !== motion) pose = blendPose(motionPose(prev, mtime + 1, phase, speed, aux, seed), pose, smoothstep(0, 0.25, mtime))
        return { kind: cast[i]!.kind, x: lerp(tr.x), z: lerp(tr.z), heading: lerp(tr.h), pose, seed, speed, phase }
      })
      let ballFrame: BallFrame | null = null
      if (football) {
        const q0 = ballQ.subarray(i0 * 4, i0 * 4 + 4)
        const q1 = ballQ.subarray(i1 * 4, i1 * 4 + 4)
        // nlerp, taking the short way.
        const dot = q0[0]! * q1[0]! + q0[1]! * q1[1]! + q0[2]! * q1[2]! + q0[3]! * q1[3]!
        const sgn = dot < 0 ? -1 : 1
        const q = [0, 1, 2, 3].map((j) => q0[j]! + (sgn * q1[j]! - q0[j]!) * w)
        const qn = Math.hypot(...q)
        ballFrame = { x: lerp(ballX), y: lerp(ballY), z: lerp(ballZ), q: q.map((v) => v / qn) as [number, number, number, number] }
      }
      const smooth = { x: lerp(sx), z: lerp(sz), heading: lerp(sh) }
      const lead = actors[0]!
      const focus = ballFrame
        ? { x: lead.x * 0.7 + ballFrame.x * 0.3, y: 0.8, z: lead.z * 0.7 + ballFrame.z * 0.3 }
        : { x: lead.x, y: 0.9, z: lead.z }
      return { actors, ball: ballFrame, smooth, focus }
    },
  }
}

function motionPose(motion: Motion, mtime: number, phase: number, speed: number, aux: number, seed: number): Pose {
  switch (motion) {
    case 'idle':
      return idle(mtime, seed)
    case 'gait':
      return gait(phase, runAmount(speed))
    case 'kick':
      return kick(aux, phase)
    case 'celebrate':
      return celebrate(mtime, seed)
    case 'hop':
      return hop(mtime, seed)
    case 'dance':
      return dance(mtime, seed)
    case 'keeper':
      return keeper(mtime, aux)
    case 'wave':
      return wave(mtime, seed)
  }
}

/** The moment (seconds into the story) the hero's kick connects, or null. */
export function kickMoment(spec: WorldSpec): number | null {
  let t = 0
  for (const b of spec.beats) {
    if (b.action === 'kick') return t + Math.max(0.5, b.duration) * KICK_CONTACT
    t += Math.max(0.5, b.duration)
  }
  return null
}
