/**
 * Procedural body animation for the 3D characters: every pose is a pure
 * function of time (or stride phase), so a frame looks the same in the live
 * preview and in the export.
 *
 * Angles are radians. Sign conventions (character facing +z, y up):
 *  - shoulder / hip / foot pitch: + swings the limb forward (and up);
 *  - elbow / knee: + bends (elbow folds forward, knee folds backward);
 *  - armOut: + raises the arm sideways; lean: + bends the torso forward;
 *  - twist / headYaw: + turns left; hipSway: + tilts the body to its left.
 */
export interface Pose {
  /** Vertical offset of the hips (m). */
  bob: number
  lean: number
  twist: number
  hipSway: number
  headPitch: number
  headYaw: number
  shoulderL: number
  shoulderR: number
  armOutL: number
  armOutR: number
  elbowL: number
  elbowR: number
  hipL: number
  hipR: number
  kneeL: number
  kneeR: number
  footL: number
  footR: number
}

export const POSE_KEYS = [
  'bob',
  'lean',
  'twist',
  'hipSway',
  'headPitch',
  'headYaw',
  'shoulderL',
  'shoulderR',
  'armOutL',
  'armOutR',
  'elbowL',
  'elbowR',
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
  'footL',
  'footR',
] as const satisfies readonly (keyof Pose)[]

export const REST: Pose = {
  bob: 0,
  lean: 0,
  twist: 0,
  hipSway: 0,
  headPitch: 0,
  headYaw: 0,
  shoulderL: 0,
  shoulderR: 0,
  armOutL: 0.12,
  armOutR: 0.12,
  elbowL: 0.18,
  elbowR: 0.18,
  hipL: 0,
  hipR: 0,
  kneeL: 0.04,
  kneeR: 0.04,
  footL: 0,
  footR: 0,
}

const TAU = Math.PI * 2
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export function blendPose(a: Pose, b: Pose, w: number): Pose {
  const out = { ...a }
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * w
  return out
}

/** Standing: breathing, a little weight shift, looking around. */
export function idle(t: number, seed = 0): Pose {
  const s = seed * 2.39
  const breath = Math.sin((TAU * t) / 3.4 + s)
  return {
    ...REST,
    bob: 0.004 * breath,
    lean: 0.03 + 0.015 * breath,
    hipSway: 0.025 * Math.sin((TAU * t) / 5.1 + s),
    headYaw: 0.35 * Math.sin((TAU * t) / 6.3 + s) * Math.sin((TAU * t) / 2.9 + s),
    headPitch: -0.04 + 0.03 * Math.sin((TAU * t) / 4.2 + s),
    armOutL: 0.13 + 0.02 * breath,
    armOutR: 0.13 + 0.02 * breath,
    elbowL: 0.2 + 0.04 * breath,
    elbowR: 0.24 + 0.04 * breath,
  }
}

/** A gait cycle: `phase` advances 2π per full stride (left + right step). `run` 0 = walk, 1 = sprint. */
export function gait(phase: number, run: number): Pose {
  const r = clamp01(run)
  const s = Math.sin(phase)
  const c = Math.cos(phase)
  const hipAmp = 0.42 + 0.38 * r
  // Knees fold while the leg swings forward (cos > 0 for the left leg), more when running.
  const swingL = Math.max(0, c) ** 1.3
  const swingR = Math.max(0, -c) ** 1.3
  const knee = (sw: number, stance: number) => 0.08 + (0.45 + 0.95 * r) * sw + 0.18 * r * stance
  return {
    ...REST,
    // Walking: highest mid-stance; running: highest in flight.
    bob: r < 0.5 ? 0.024 * (1 - Math.abs(s)) - 0.012 : 0.05 * Math.abs(s) - 0.03,
    lean: 0.05 + 0.2 * r,
    twist: (0.07 + 0.06 * r) * s,
    hipSway: 0.035 * (1 - r) * s,
    headPitch: -0.04 - 0.06 * r,
    headYaw: -0.05 * s,
    hipL: hipAmp * s,
    hipR: -hipAmp * s,
    kneeL: knee(swingL, 1 - swingL),
    kneeR: knee(swingR, 1 - swingR),
    footL: -0.25 * s * (0.5 + r) + 0.2 * swingL,
    footR: 0.25 * s * (0.5 + r) + 0.2 * swingR,
    // Arms swing opposite to the legs; elbows bend more when running.
    shoulderL: -(0.35 + 0.5 * r) * s,
    shoulderR: (0.35 + 0.5 * r) * s,
    armOutL: 0.1 + 0.06 * r,
    armOutR: 0.1 + 0.06 * r,
    elbowL: 0.3 + 1.1 * r + 0.15 * Math.max(0, -s),
    elbowR: 0.3 + 1.1 * r + 0.15 * Math.max(0, s),
  }
}

/** When the foot meets the ball, as a fraction of the kick clip. */
export const KICK_CONTACT = 0.68

/**
 * A right-footed kick over u ∈ [0, 1]: approach stride, wind-up (leg back,
 * arms out), strike (leg whips through, body leans back), follow-through.
 */
export function kick(u: number, approachPhase: number): Pose {
  const approach = gait(approachPhase, 0.7)
  const wind = smooth(0.4, 0.6, u) * (1 - smooth(0.6, 0.66, u))
  const strike = smooth(0.6, 0.7, u) * (1 - smooth(0.78, 1, u))
  const settle = smooth(0.7, 1, u)
  const kicking = smooth(0.38, 0.5, u)
  const pose = blendPose(approach, { ...idle(u * 2), lean: 0.05 }, kicking)
  return {
    ...pose,
    lean: pose.lean + 0.12 * wind - 0.22 * strike,
    twist: pose.twist + 0.25 * wind - 0.35 * strike,
    hipR: pose.hipR * (1 - kicking) - 0.95 * wind + 1.45 * strike + 0.3 * settle * (1 - settle),
    kneeR: pose.kneeR * (1 - kicking) + 1.4 * wind + 0.12 * strike,
    footR: pose.footR * (1 - kicking) - 0.3 * wind + 0.35 * strike,
    hipL: pose.hipL * (1 - kicking) + 0.1 * wind - 0.15 * strike,
    kneeL: pose.kneeL * (1 - kicking) + 0.25 * (wind + strike),
    armOutL: pose.armOutL + 0.9 * (wind + strike),
    armOutR: pose.armOutR + 0.6 * (wind + strike),
    shoulderL: pose.shoulderL * (1 - kicking) + 0.5 * strike,
    shoulderR: pose.shoulderR * (1 - kicking) - 0.4 * strike,
    headPitch: pose.headPitch + 0.18 * (wind + strike),
  }
}

/** Jumping for joy: hops with both arms thrown up. Returns the pose and the jump height (m). */
export function celebrate(t: number, seed = 0): Pose {
  const cycle = 0.78
  const u = (t / cycle + seed * 0.37) % 1
  const air = Math.sin(Math.PI * clamp01((u - 0.15) / 0.7))
  const squat = 1 - air
  return {
    ...REST,
    bob: 0.32 * air - 0.08 * squat * smooth(0, 0.15, u),
    lean: 0.1 * squat,
    hipL: 0.35 * air + 0.25 * squat,
    hipR: 0.35 * air + 0.25 * squat,
    kneeL: 0.8 * air + 0.55 * squat,
    kneeR: 0.8 * air + 0.55 * squat,
    footL: -0.3 * air,
    footR: -0.3 * air,
    shoulderL: 2.6 + 0.3 * air,
    shoulderR: 2.6 + 0.3 * air,
    armOutL: 0.35 + 0.2 * Math.sin(TAU * u),
    armOutR: 0.35 - 0.2 * Math.sin(TAU * u),
    elbowL: 0.25,
    elbowR: 0.25,
    headPitch: -0.25 * air,
  }
}

/** Hopping on the spot, arms swinging (skipping-rope style). */
export function hop(t: number, seed = 0): Pose {
  const cycle = 0.5
  const u = (t / cycle + seed * 0.29) % 1
  const air = Math.sin(Math.PI * u)
  return {
    ...REST,
    bob: 0.16 * air,
    lean: 0.05,
    kneeL: 0.25 + 0.35 * (1 - air),
    kneeR: 0.25 + 0.35 * (1 - air),
    hipL: 0.15 + 0.15 * air,
    hipR: 0.15 + 0.15 * air,
    footL: -0.25 * air,
    footR: -0.25 * air,
    shoulderL: 0.5 * Math.sin(TAU * u),
    shoulderR: 0.5 * Math.sin(TAU * u),
    armOutL: 0.45,
    armOutR: 0.45,
    elbowL: 0.6,
    elbowR: 0.6,
  }
}

/** A lively folk-style dance: bouncing knees, alternating raised arms, swaying hips and turning shoulders. */
export function dance(t: number, seed = 0): Pose {
  const beat = 0.48
  const b = t / beat + seed * 0.5
  const bounce = Math.abs(Math.sin(Math.PI * b))
  const side = Math.sin((Math.PI * b) / 2)
  const up = (Math.PI * b) / 2
  return {
    ...REST,
    bob: 0.06 * bounce - 0.03,
    lean: 0.06,
    twist: 0.32 * side,
    hipSway: 0.14 * side,
    headYaw: 0.3 * side,
    headPitch: -0.12,
    kneeL: 0.3 + 0.3 * (1 - bounce) + 0.2 * Math.max(0, side),
    kneeR: 0.3 + 0.3 * (1 - bounce) + 0.2 * Math.max(0, -side),
    hipL: 0.2 + 0.35 * Math.max(0, Math.sin(up)),
    hipR: 0.2 + 0.35 * Math.max(0, -Math.sin(up)),
    shoulderL: 1.6 + 1.1 * Math.max(0, Math.sin(up)),
    shoulderR: 1.6 + 1.1 * Math.max(0, -Math.sin(up)),
    armOutL: 0.7 + 0.25 * Math.sin(up),
    armOutR: 0.7 - 0.25 * Math.sin(up),
    elbowL: 0.5 + 0.4 * Math.abs(Math.cos(up)),
    elbowR: 0.5 + 0.4 * Math.abs(Math.sin(up)),
  }
}

/** A goalkeeper's ready stance with side-steps; `dive` (0..1) throws the arms up for a save attempt. */
export function keeper(t: number, dive: number): Pose {
  const step = Math.sin(TAU * t * 0.9)
  const ready: Pose = {
    ...REST,
    bob: -0.07 + 0.015 * Math.abs(step),
    lean: 0.32,
    headPitch: -0.3,
    hipL: 0.35 + 0.1 * step,
    hipR: 0.35 - 0.1 * step,
    kneeL: 0.7,
    kneeR: 0.7,
    footL: -0.2,
    footR: -0.2,
    shoulderL: 0.7,
    shoulderR: 0.7,
    armOutL: 0.55,
    armOutR: 0.55,
    elbowL: 0.6,
    elbowR: 0.6,
  }
  return blendPose(ready, celebrate(0.35), clamp01(dive))
}

/** Waving with the right arm while standing. */
export function wave(t: number, seed = 0): Pose {
  return {
    ...idle(t, seed),
    shoulderR: 2.5,
    armOutR: 0.55 + 0.25 * Math.sin(TAU * t * 1.6),
    elbowR: 0.55 + 0.35 * Math.sin(TAU * t * 1.6),
  }
}
