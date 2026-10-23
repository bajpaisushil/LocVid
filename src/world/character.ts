import {
  BackSide,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three'
import type { CastKind } from '@/core/types'
import { createRng } from '@/lib/math'
import type { Pose } from './poses'
import { outlineGeometry, toon } from './toon'

/**
 * Procedural cartoon characters: a jointed body (hips, torso, head, two-part
 * arms and legs, feet) built from simple rounded shapes with toon shading and
 * an ink outline, posed every frame from a `Pose` (see poses.ts).
 *
 * The character faces +z with y up; its left side is +x.
 */

export interface Character {
  root: Group
  kind: CastKind
  /** Standing height (m). */
  height: number
  /** Pose the body, place it and face it (heading: direction (sin h, cos h)); `phase`/`speed` drive quadrupeds. */
  update(pose: Pose, x: number, z: number, heading: number, time: number, phase: number, speed: number): void
  dispose(): void
}

const SKIN = ['#8d5524', '#a0662f', '#b97a45', '#c68642', '#7a4a24', '#d9a066', '#e8b98a', '#5c3a1e']
const SHIRT = ['#d7263d', '#1b98e0', '#f4d35e', '#2a9d8f', '#f77f00', '#f1faee', '#7b2cbf', '#ff70a6', '#3ec300', '#00a6a6']
const BOTTOM = ['#22333b', '#a68a64', '#1d1d1d', '#3a6ea5', '#6f4e37', '#264653']
const HAIR = ['#141414', '#1f1410', '#3b2314', '#2a1b0f']
const SHOES = ['#2b2b2b', '#5a3a22', '#8a5a2b', '#e9e9e9', '#c0392b']
const DRESS = ['#e63946', '#ffb703', '#8338ec', '#06d6a0', '#ef476f', '#118ab2']

interface Proportions {
  thigh: number
  shin: number
  torso: number
  head: number
  upperArm: number
  forearm: number
  width: number
}

function proportions(kind: CastKind, rng: () => number): Proportions {
  const kid = kind === 'boy' || kind === 'girl'
  const s = (kid ? 1 : 1.42) * (0.94 + rng() * 0.12)
  return {
    thigh: 0.28 * s * (kid ? 1 : 1.04),
    shin: 0.26 * s * (kid ? 1 : 1.04),
    torso: 0.36 * s,
    head: kid ? 0.152 : 0.13 * (0.95 + rng() * 0.1),
    upperArm: 0.2 * s,
    forearm: 0.18 * s,
    width: (kid ? 1 : 1.25) * (kind === 'girl' || kind === 'woman' ? 0.92 : 1),
  }
}

const pick = <T,>(list: readonly T[], rng: () => number): T => list[Math.floor(rng() * list.length)]!

class Builder {
  readonly materials: Material[] = []
  readonly geometries: BufferGeometry[] = []
  private readonly ink = new MeshBasicMaterial({ color: '#141010', side: BackSide })
  private readonly cache = new Map<string, Material>()

  constructor() {
    this.materials.push(this.ink)
  }

  mat(color: string): Material {
    let m = this.cache.get(color)
    if (!m) {
      m = toon(color)
      this.cache.set(color, m)
      this.materials.push(m)
    }
    return m
  }

  /** A shaded mesh, with an ink outline when `ink` > 0. */
  mesh(geometry: BufferGeometry, color: string, ink = 0): Object3D {
    this.geometries.push(geometry)
    const m = new Mesh(geometry, this.mat(color))
    // Characters cast shadows but don't receive them: self-shadowing on small rounded
    // shapes only adds blotches (shadow acne) to faces and limbs.
    m.castShadow = true
    m.receiveShadow = false
    if (ink > 0) {
      const og = outlineGeometry(geometry, ink)
      this.geometries.push(og)
      const o = new Mesh(og, this.ink)
      m.add(o)
    }
    return m
  }
}

/** A capsule hanging down from its top joint (length = joint to joint). */
function limb(radius: number, length: number): BufferGeometry {
  const g = new CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 4, 10)
  g.translate(0, -length / 2, 0)
  return g
}

export function buildCharacter(kind: CastKind, look: number): Character {
  if (kind === 'dog') return buildDog(look)
  const rng = createRng(look * 131 + 7)
  const p = proportions(kind, rng)
  const b = new Builder()
  const female = kind === 'girl' || kind === 'woman'
  const adult = kind === 'man' || kind === 'woman'
  const skin = pick(SKIN, rng)
  const shirt = pick(SHIRT, rng)
  const bottom = pick(BOTTOM, rng)
  const hair = pick(HAIR, rng)
  const shoe = pick(SHOES, rng)
  const dress = female ? pick(DRESS, rng) : null
  const ink = adult ? 0.011 : 0.009
  const W = p.width
  const legLen = p.thigh + p.shin + 0.045

  const root = new Group()
  const hips = new Group()
  root.add(hips)

  // Waist piece.
  const pelvis = b.mesh(new CapsuleGeometry(0.095 * W, 0.08 * W, 4, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.75), dress ?? bottom, ink)
  hips.add(pelvis)

  // Torso: pivots at the hips (lean, twist).
  const torso = new Group()
  hips.add(torso)
  const chest = b.mesh(new CapsuleGeometry(0.115 * W, p.torso - 0.12 * W, 4, 12).translate(0, p.torso / 2, 0).scale(1.12, 1, 0.72), dress ?? shirt, ink)
  torso.add(chest)
  if (dress && kind === 'girl') {
    // Flared outfit from the waist.
    const skirt = b.mesh(new CylinderGeometry(0.12 * W, 0.24 * W, p.thigh * 0.95, 14, 1, true).translate(0, -p.thigh * 0.45, 0), dress, ink)
    hips.add(skirt)
  } else if (dress && kind === 'woman') {
    // Long outfit down to the ankles.
    const skirt = b.mesh(new CylinderGeometry(0.13 * W, 0.3 * W, legLen * 0.92, 16, 1, true).translate(0, -legLen * 0.44, 0), dress, ink)
    hips.add(skirt)
  }

  // Head on a neck: pitch/yaw.
  const neck = new Group()
  neck.position.y = p.torso + 0.035
  torso.add(neck)
  const r = p.head
  const head = b.mesh(new SphereGeometry(r, 22, 16).scale(0.98, 1.04, 0.98).translate(0, r * 0.95, 0), skin, ink)
  neck.add(head)
  neck.add(b.mesh(new CylinderGeometry(r * 0.32, r * 0.36, 0.08, 10).translate(0, 0.0, 0), skin))
  // Hair: a cap tilted back, optionally longer at the back.
  const cap = b.mesh(new SphereGeometry(r * 1.07, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.52).rotateX(-0.32).translate(0, r * 1.0, -r * 0.04), hair)
  neck.add(cap)
  if (female) {
    const long = b.mesh(new SphereGeometry(r * 1.05, 18, 12, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.35, Math.PI * 0.55).rotateY(Math.PI).translate(0, r * 0.75, -r * 0.08).scale(1, adult ? 1.5 : 1.3, 1), hair)
    neck.add(long)
    const tail = b.mesh(new SphereGeometry(r * 0.32, 10, 8).scale(0.8, 1.6, 0.8).translate(0, r * 0.55, -r * 1.1), hair)
    neck.add(tail)
  }
  // Face (facing +z): eyes with pupils, brows, nose, smile, ears.
  for (const sx of [-1, 1]) {
    neck.add(b.mesh(new SphereGeometry(r * 0.17, 12, 10).scale(0.95, 1.15, 0.55).translate(sx * r * 0.36, r * 1.05, r * 0.86), '#fbfbf6'))
    neck.add(b.mesh(new SphereGeometry(r * 0.095, 10, 8).scale(1, 1.15, 0.6).translate(sx * r * 0.35, r * 1.03, r * 0.93), '#1a1410'))
    neck.add(b.mesh(new BoxGeometry(r * 0.26, r * 0.045, r * 0.05).rotateZ(sx * -0.12).translate(sx * r * 0.36, r * 1.31, r * 0.86), hair))
    neck.add(b.mesh(new SphereGeometry(r * 0.2, 10, 8).scale(0.45, 1, 0.75).translate(sx * r * 0.99, r * 0.95, 0), skin))
  }
  neck.add(b.mesh(new SphereGeometry(r * 0.085, 10, 8).translate(0, r * 0.88, r * 0.99), new Color(skin).multiplyScalar(0.88).getStyle()))
  neck.add(b.mesh(new TorusGeometry(r * 0.2, r * 0.035, 6, 14, Math.PI).rotateZ(Math.PI).translate(0, r * 0.68, r * 0.9), '#7a1f1f'))

  // Arms: shoulder (pitch + abduction) → elbow (bend) → hand.
  const makeArm = (sx: number) => {
    const shoulder = new Group()
    shoulder.position.set(sx * 0.165 * W, p.torso - 0.045, 0)
    torso.add(shoulder)
    shoulder.add(b.mesh(limb(0.047 * W, p.upperArm), adult && kind === 'man' ? shirt : (dress ?? shirt), ink))
    const elbow = new Group()
    elbow.position.y = -p.upperArm
    shoulder.add(elbow)
    elbow.add(b.mesh(limb(0.04 * W, p.forearm), skin, ink))
    elbow.add(b.mesh(new SphereGeometry(0.045 * W, 10, 8).translate(0, -p.forearm - 0.02, 0), skin, ink))
    return { shoulder, elbow }
  }
  const armL = makeArm(1)
  const armR = makeArm(-1)

  // Legs: hip (pitch) → knee (bend) → ankle (foot pitch).
  const legColor = adult && kind === 'man' ? bottom : skin
  const makeLeg = (sx: number) => {
    const hip = new Group()
    hip.position.set(sx * 0.075 * W, -0.02, 0)
    hips.add(hip)
    // Outfit color on the upper leg (or the whole leg for long trousers).
    hip.add(b.mesh(limb(0.062 * W, p.thigh), kind === 'boy' || kind === 'man' ? bottom : skin, ink))
    if (kind === 'boy') hip.add(b.mesh(limb(0.07 * W, p.thigh * 0.55), bottom))
    const knee = new Group()
    knee.position.y = -p.thigh
    hip.add(knee)
    knee.add(b.mesh(limb(0.05 * W, p.shin), legColor, ink))
    const ankle = new Group()
    ankle.position.y = -p.shin
    knee.add(ankle)
    ankle.add(b.mesh(new BoxGeometry(0.09 * W, 0.05, 0.17 * W).translate(0, -0.02, 0.04 * W), shoe, ink))
    return { hip, knee, ankle }
  }
  const legL = makeLeg(1)
  const legR = makeLeg(-1)

  const height = legLen + p.torso + 0.035 + r * 2
  return {
    root,
    kind,
    height,
    update(pose, x, z, heading) {
      root.position.set(x, 0, z)
      root.rotation.y = heading
      hips.position.y = legLen + pose.bob
      hips.rotation.set(0, 0, pose.hipSway)
      torso.rotation.set(pose.lean, pose.twist, 0)
      neck.rotation.set(pose.headPitch, pose.headYaw, 0)
      armL.shoulder.rotation.set(-pose.shoulderL, 0, pose.armOutL)
      armR.shoulder.rotation.set(-pose.shoulderR, 0, -pose.armOutR)
      armL.elbow.rotation.set(-pose.elbowL, 0, 0)
      armR.elbow.rotation.set(-pose.elbowR, 0, 0)
      legL.hip.rotation.set(-pose.hipL, 0, 0.03)
      legR.hip.rotation.set(-pose.hipR, 0, -0.03)
      legL.knee.rotation.set(pose.kneeL, 0, 0)
      legR.knee.rotation.set(pose.kneeR, 0, 0)
      legL.ankle.rotation.set(-pose.footL, 0, 0)
      legR.ankle.rotation.set(-pose.footR, 0, 0)
    },
    dispose() {
      for (const g of b.geometries) g.dispose()
      for (const m of b.materials) m.dispose()
    },
  }
}

/** A friendly dog: body, head with snout and ears, four legs, a wagging tail; trots with its owner. */
function buildDog(look: number): Character {
  const rng = createRng(look * 37 + 3)
  const b = new Builder()
  const coat = pick(['#c89b5a', '#7b5230', '#f1e3c6', '#2b2622', '#d4a373'], rng)
  const patch = new Color(coat).multiplyScalar(0.7).getStyle()
  const ink = 0.008
  const root = new Group()
  const body = new Group()
  body.position.y = 0.36
  root.add(body)
  body.add(b.mesh(new CapsuleGeometry(0.13, 0.32, 4, 12).rotateX(Math.PI / 2), coat, ink))
  const neck = new Group()
  neck.position.set(0, 0.08, 0.24)
  body.add(neck)
  neck.add(b.mesh(new SphereGeometry(0.12, 16, 12).translate(0, 0.08, 0.06), coat, ink))
  neck.add(b.mesh(new CapsuleGeometry(0.055, 0.08, 4, 8).rotateX(Math.PI / 2).translate(0, 0.05, 0.17), patch, ink))
  neck.add(b.mesh(new SphereGeometry(0.025, 8, 6).translate(0, 0.07, 0.24), '#151010'))
  for (const sx of [-1, 1]) {
    neck.add(b.mesh(new SphereGeometry(0.022, 8, 6).translate(sx * 0.05, 0.13, 0.15), '#151010'))
    neck.add(b.mesh(new ConeGeometry(0.045, 0.1, 6).rotateZ(sx * 0.5).translate(sx * 0.07, 0.19, 0.03), patch, ink))
  }
  const legs: Group[] = []
  for (const [lx, lz] of [
    [0.08, 0.2],
    [-0.08, 0.2],
    [0.08, -0.2],
    [-0.08, -0.2],
  ] as const) {
    const leg = new Group()
    leg.position.set(lx, -0.02, lz)
    body.add(leg)
    leg.add(b.mesh(limb(0.035, 0.34), coat, ink))
    legs.push(leg)
  }
  const tail = new Group()
  tail.position.set(0, 0.08, -0.3)
  body.add(tail)
  tail.add(b.mesh(new CapsuleGeometry(0.022, 0.16, 4, 6).translate(0, 0.08, 0).rotateX(-0.6), coat, ink))
  return {
    root,
    kind: 'dog',
    height: 0.6,
    update(_pose, x, z, heading, time, phase, speed) {
      root.position.set(x, 0, z)
      root.rotation.y = heading
      const trot = Math.min(1, speed / 2)
      const p = phase * 2
      const swing = 0.55 * trot
      legs[0]!.rotation.x = Math.sin(p) * swing
      legs[3]!.rotation.x = Math.sin(p) * swing
      legs[1]!.rotation.x = -Math.sin(p) * swing
      legs[2]!.rotation.x = -Math.sin(p) * swing
      body.position.y = 0.36 + Math.abs(Math.sin(p)) * 0.03 * trot
      neck.rotation.x = 0.1 * Math.sin(p) * trot - 0.05 + 0.04 * Math.sin(time * 6) * (1 - trot)
      tail.rotation.y = Math.sin(time * 14) * 0.6
    },
    dispose() {
      for (const g of b.geometries) g.dispose()
      for (const m of b.materials) m.dispose()
    },
  }
}
