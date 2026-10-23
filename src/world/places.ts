import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three'
import type { WorldPlace, WorldTimeOfDay } from '@/core/types'
import { createRng } from '@/lib/math'
import type { Pitch } from './choreography'
import { Batch, toon } from './toon'

/**
 * Procedural places for the 3D worlds, built from a seed: the ground and
 * distant hills, the pitch where the action happens, and the surroundings —
 * a village, a park, a beach, a city plaza or a snowy village. Static
 * scenery is merged into a few vertex-colored meshes.
 *
 * Layout: the pitch is centered on the origin; nothing tall stands within
 * ~17 m of it, so cameras working the action never clip through scenery.
 */

export interface Place {
  group: Group
  dispose(): void
}

type Rng = () => number

const m4 = (x: number, y: number, z: number, ry = 0, s: [number, number, number] = [1, 1, 1]) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry), new Vector3(...s))

const pick = <T,>(list: readonly T[], rng: Rng): T => list[Math.floor(rng() * list.length)]!

/** Smooth value noise on the ground plane, 0..1. */
function groundNoise(seed: number) {
  const r = createRng(seed)
  const table = Array.from({ length: 256 }, () => r())
  const at = (ix: number, iz: number) => table[((ix * 73856093) ^ (iz * 19349663)) & 255]!
  return (x: number, z: number) => {
    const fx = Math.floor(x)
    const fz = Math.floor(z)
    const tx = x - fx
    const tz = z - fz
    const sx = tx * tx * (3 - 2 * tx)
    const sz = tz * tz * (3 - 2 * tz)
    const a = at(fx, fz) + (at(fx + 1, fz) - at(fx, fz)) * sx
    const b = at(fx, fz + 1) + (at(fx + 1, fz + 1) - at(fx, fz + 1)) * sx
    return a + (b - a) * sz
  }
}

interface Palette {
  grass: string[]
  pitch: string
  hills: string
  far: string
}

const PALETTES: Record<WorldPlace, Palette> = {
  village: { grass: ['#7aa646', '#6c9a3e', '#8bb252'], pitch: '#c9a26b', hills: '#6f9a55', far: '#8fb0a0' },
  park: { grass: ['#6fb04a', '#62a343', '#7dbd55'], pitch: '#5fa944', hills: '#5e9a4c', far: '#94b8a8' },
  beach: { grass: ['#e8d3a2', '#e2c995', '#efdcae'], pitch: '#ead6a6', hills: '#7aa86a', far: '#a7c4cf' },
  city: { grass: ['#8a8d92', '#7f8287', '#93969b'], pitch: '#b9b4aa', hills: '#7c8a8f', far: '#9fb0bd' },
  snow: { grass: ['#eef3f7', '#e3ebf1', '#f6f9fb'], pitch: '#f3f6f9', hills: '#d9e3ec', far: '#c3d1df' },
}

/** The ground: a big disc with color variation, the pitch area, and hills rising in the distance. */
function ground(place: WorldPlace, pitch: Pitch, seed: number): BufferGeometry {
  const pal = PALETTES[place]
  const noise = groundNoise(seed)
  // A polar grid, so hills can rise smoothly in the distance.
  const rings = 70
  const segs = 96
  const positions: number[] = []
  const colors: number[] = []
  const grass = pal.grass.map((c) => new Color(c))
  const pitchColor = new Color(pal.pitch)
  const hill = new Color(pal.hills)
  const far = new Color(pal.far)
  const radiusAt = (i: number) => 260 * (i / rings) ** 1.7
  const vertex = (i: number, j: number) => {
    const r = radiusAt(i)
    const a = (j / segs) * Math.PI * 2
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const n = noise(x * 0.08, z * 0.08)
    const rise = Math.max(0, (r - 70) / 120)
    const y = rise > 0 ? rise * rise * (10 + 26 * noise(x * 0.02 + 9, z * 0.02 + 3)) : 0
    // Pitch: a rounded rectangle blending into the surroundings.
    const px = Math.max(0, Math.abs(x) - pitch.halfX)
    const pz = Math.max(0, Math.abs(z) - pitch.halfZ)
    const inPitch = 1 - Math.min(1, Math.hypot(px, pz) / 2.5)
    let c = grass[Math.floor(n * grass.length) % grass.length]!.clone().lerp(grass[(Math.floor(n * 7) + 1) % grass.length]!, n)
    c.multiplyScalar(0.92 + 0.16 * noise(x * 0.5, z * 0.5))
    if (inPitch > 0) c = c.lerp(pitchColor.clone().multiplyScalar(0.94 + 0.12 * noise(x * 0.9, z * 0.9)), inPitch)
    if (rise > 0) c = c.lerp(hill, Math.min(1, rise * 1.5)).lerp(far, Math.min(1, Math.max(0, rise - 0.6)))
    return { p: [x, y, z], c }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = vertex(i, j)
      const b = vertex(i + 1, j)
      const c = vertex(i + 1, j + 1)
      const d = vertex(i, j + 1)
      for (const v of [a, c, b, a, d, c]) {
        positions.push(...v.p)
        colors.push(v.c.r, v.c.g, v.c.b)
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

/** A triangular-prism (gable) roof spanning w (x) by d (z), height h, base at y = 0. */
function gableRoof(w: number, d: number, h: number): BufferGeometry {
  const x = w / 2
  const z = d / 2
  const v = [
    [-x, 0, -z], [x, 0, -z], [0, h, -z],
    [-x, 0, z], [0, h, z], [x, 0, z],
    [-x, 0, -z], [0, h, -z], [0, h, z], [-x, 0, -z], [0, h, z], [-x, 0, z],
    [x, 0, -z], [x, 0, z], [0, h, z], [x, 0, -z], [0, h, z], [0, h, -z],
  ]
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(v.flat(), 3))
  g.computeVertexNormals()
  return g
}

function addTree(b: Batch, rng: Rng, x: number, z: number, kind: 'round' | 'palm' | 'pine', scale = 1) {
  const s = scale * (0.85 + rng() * 0.4)
  if (kind === 'palm') {
    const lean = (rng() - 0.5) * 0.5
    const segments = 6
    let px = x
    let py = 0
    let pz = z
    for (let i = 0; i < segments; i++) {
      const h = 1.1 * s
      b.add(new CylinderGeometry(0.16 * s * (1 - i * 0.08), 0.2 * s * (1 - i * 0.08), h, 7), '#8a6a45', m4(px, py + h / 2, pz))
      py += h
      px += lean * 0.25 * s
    }
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rng()
      const frond = new ConeGeometry(0.35 * s, 2.6 * s, 4).rotateZ(Math.PI / 2 + 0.5).translate(1.2 * s, -0.3 * s, 0)
      b.add(frond, pick(['#3f8a3a', '#4c9a42', '#357a33'], rng), m4(px, py, pz, a))
    }
    return
  }
  if (kind === 'pine') {
    b.add(new CylinderGeometry(0.15 * s, 0.22 * s, 1.4 * s, 6), '#6b4a2e', m4(x, 0.7 * s, z))
    for (let k = 0; k < 3; k++) {
      b.add(new ConeGeometry((1.6 - k * 0.42) * s, 2.2 * s, 7), pick(['#2f5d3a', '#376b42', '#2a5434'], rng), m4(x, (1.6 + k * 1.15) * s, z, rng()))
    }
    return
  }
  const trunkH = (2 + rng() * 1.2) * s
  b.add(new CylinderGeometry(0.2 * s, 0.32 * s, trunkH, 7), '#6b4423', m4(x, trunkH / 2, z))
  const blobs = 3 + Math.floor(rng() * 3)
  for (let k = 0; k < blobs; k++) {
    const a = rng() * Math.PI * 2
    const r = (0.4 + rng() * 0.8) * s
    const size = (1.2 + rng() * 0.9) * s
    b.add(new IcosahedronGeometry(size, 1), pick(['#4f7942', '#5a8f3c', '#3f6b35', '#66994a'], rng), m4(x + Math.cos(a) * r, trunkH + size * 0.6 + rng() * 0.7 * s, z + Math.sin(a) * r, rng(), [1, 0.85, 1]))
  }
}

/** A house facing the pitch center: walls, roof, door, windows; `night` lights the windows. */
function addHouse(b: Batch, rng: Rng, x: number, z: number, style: 'village' | 'snow' | 'beach', night: boolean) {
  const face = Math.atan2(-x, -z)
  const w = 3.2 + rng() * 2.2
  const d = 3 + rng() * 1.6
  const h = 2.3 + rng() * 0.9
  const walls =
    style === 'snow' ? pick(['#8a5a3c', '#a0522d', '#7d5a44', '#b5835a'], rng) : style === 'beach' ? pick(['#f4f1de', '#ffd6a5', '#bde0fe', '#caffbf'], rng) : pick(['#e8d5b7', '#d9a46c', '#c97b4a', '#9fc5d8', '#f2e3c9', '#e9c46a'], rng)
  const roof = style === 'snow' ? '#f4f7fa' : style === 'beach' ? pick(['#b08d57', '#c9a227'], rng) : pick(['#b08d57', '#a8432e', '#8c5a3c', '#9c6644', '#c2a15e'], rng)
  const base = m4(x, 0, z, face)
  const at = (lx: number, ly: number, lz: number, s: [number, number, number] = [1, 1, 1]) => base.clone().multiply(m4(lx, ly, lz, 0, s))
  b.add(new BoxGeometry(w, h, d), walls, at(0, h / 2, 0))
  // Plinth.
  b.add(new BoxGeometry(w + 0.3, 0.3, d + 0.3), new Color(walls).multiplyScalar(0.75), at(0, 0.15, 0))
  if (rng() < 0.55) b.add(gableRoof(w + 0.6, d + 0.6, 1.3 + rng() * 0.6), roof, at(0, h, 0))
  else b.add(new ConeGeometry(Math.max(w, d) * 0.78, 1.5 + rng() * 0.5, 4).rotateY(Math.PI / 4), roof, at(0, h + 0.7, 0, [w / Math.max(w, d), 1, d / Math.max(w, d)]))
  // Door and windows on the side facing the pitch (+z local).
  const lit = night ? '#ffd27a' : '#2e2622'
  b.add(new BoxGeometry(0.8, 1.6, 0.06), night ? '#5a3a26' : '#4a3020', at(-w * 0.18, 0.8, d / 2 + 0.03))
  b.add(new BoxGeometry(0.6, 0.55, 0.06), lit, at(w * 0.22, h * 0.58, d / 2 + 0.03))
  if (w > 4) b.add(new BoxGeometry(0.6, 0.55, 0.06), lit, at(-w * 0.38, h * 0.58, d / 2 + 0.03))
  // Some have a veranda with two posts.
  if (rng() < 0.35 && style === 'village') {
    b.add(new BoxGeometry(w * 0.9, 0.12, 1.4), roof, at(0, h * 0.82, d / 2 + 0.7).multiply(new Matrix4().makeRotationX(0.12)))
    for (const sx of [-1, 1]) b.add(new CylinderGeometry(0.07, 0.07, h * 0.8, 6), '#6b4423', at(sx * w * 0.4, h * 0.4, d / 2 + 1.3))
  }
}

/** A clear spot on the ring around the pitch (not too close to things already placed). */
function scatter(rng: Rng, minR: number, maxR: number, taken: { x: number; z: number; r: number }[], clearance: number) {
  for (let tries = 0; tries < 40; tries++) {
    const a = rng() * Math.PI * 2
    const r = minR + (maxR - minR) * Math.sqrt(rng())
    const x = Math.cos(a) * r * 1.25
    const z = Math.sin(a) * r
    if (taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + clearance)) return { x, z }
  }
  return null
}

function pitchMarkings(b: Batch, pitch: Pitch, color: string) {
  const line = (w: number, d: number, x: number, z: number) => b.add(new BoxGeometry(w, 0.02, d), color, m4(x, 0.012, z))
  const { halfX: hx, halfZ: hz } = pitch
  line(hx * 2, 0.08, 0, hz)
  line(hx * 2, 0.08, 0, -hz)
  line(0.08, hz * 2, hx, 0)
  line(0.08, hz * 2, -hx, 0)
  line(0.08, hz * 2, 0, 0)
  // Center circle.
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2
    b.add(new BoxGeometry(0.08, 0.02, 0.42), color, m4(Math.cos(a) * 2.8, 0.012, Math.sin(a) * 2.8, -a))
  }
  if (pitch.goalHalfWidth > 0) {
    for (const gx of [-pitch.goalX, pitch.goalX]) {
      const s = Math.sign(gx)
      for (const pz of [-pitch.goalHalfWidth, pitch.goalHalfWidth]) b.add(new CylinderGeometry(0.06, 0.06, 1.7, 8), '#f5f5f5', m4(gx, 0.85, pz))
      b.add(new CylinderGeometry(0.06, 0.06, pitch.goalHalfWidth * 2 + 0.12, 8).rotateX(Math.PI / 2), '#f5f5f5', m4(gx, 1.7, 0))
      // Net frame going back from the goal.
      for (const pz of [-pitch.goalHalfWidth, pitch.goalHalfWidth]) b.add(new BoxGeometry(1.2, 0.04, 0.04), '#dcdcdc', m4(gx + s * 0.6, 1.2, pz))
      b.add(new BoxGeometry(0.04, 1.2, pitch.goalHalfWidth * 2), '#e8e8e8', m4(gx + s * 1.2, 0.6, 0))
    }
  }
}

export function buildPlace(place: WorldPlace, time: WorldTimeOfDay, pitch: Pitch, seed: number, football: boolean): Place {
  const rng = createRng(seed * 31 + 101)
  const group = new Group()
  const materials: Material[] = []
  const geometries: BufferGeometry[] = []
  const night = time === 'night'

  const groundGeo = ground(place, pitch, seed)
  const groundMat = toon('#ffffff', { vertexColors: true })
  const groundMesh = new Mesh(groundGeo, groundMat)
  groundMesh.receiveShadow = true
  group.add(groundMesh)
  geometries.push(groundGeo)
  materials.push(groundMat)

  const scenery = new Batch()
  const taken: { x: number; z: number; r: number }[] = [{ x: 0, z: 0, r: 17 }]
  if (football) pitchMarkings(scenery, pitch, place === 'snow' ? '#c94f4f' : '#f6f2e8')

  switch (place) {
    case 'village': {
      for (let i = 0; i < 16; i++) {
        const spot = scatter(rng, 21, 34, taken, 5.5)
        if (!spot) continue
        addHouse(scenery, rng, spot.x, spot.z, 'village', night)
        taken.push({ ...spot, r: 3 })
      }
      for (let i = 0; i < 38; i++) {
        const spot = scatter(rng, 18, 48, taken, 2.5)
        if (!spot) continue
        addTree(scenery, rng, spot.x, spot.z, rng() < 0.3 ? 'palm' : 'round', 1.1)
        taken.push({ ...spot, r: 1.5 })
      }
      // Haystacks, a well, clay pots, a cart.
      for (let i = 0; i < 6; i++) {
        const spot = scatter(rng, 18.5, 30, taken, 1.5)
        if (!spot) continue
        scenery.add(new ConeGeometry(1 + rng() * 0.4, 1.8 + rng() * 0.6, 9), '#d8b25c', m4(spot.x, 0.9, spot.z, rng()))
        taken.push({ ...spot, r: 1.2 })
      }
      const well = scatter(rng, 18.5, 24, taken, 2)
      if (well) {
        scenery.add(new CylinderGeometry(0.9, 0.95, 0.8, 14), '#a89f91', m4(well.x, 0.4, well.z))
        for (const sx of [-1, 1]) scenery.add(new CylinderGeometry(0.06, 0.06, 1.8, 6), '#6b4423', m4(well.x + sx * 0.8, 0.9, well.z))
        scenery.add(gableRoof(2, 1.2, 0.5), '#a8432e', m4(well.x, 1.8, well.z))
      }
      for (let i = 0; i < 10; i++) {
        const spot = scatter(rng, 18, 30, taken, 0.6)
        if (!spot) continue
        scenery.add(new SphereGeometry(0.28, 10, 8).scale(1, 0.9, 1), pick(['#b5532d', '#c4673b', '#8f3f24'], rng), m4(spot.x, 0.25, spot.z))
      }
      break
    }
    case 'park': {
      for (let i = 0; i < 46; i++) {
        const spot = scatter(rng, 18, 52, taken, 2.2)
        if (!spot) continue
        addTree(scenery, rng, spot.x, spot.z, 'round', 1.15)
        taken.push({ ...spot, r: 1.6 })
      }
      for (let i = 0; i < 8; i++) {
        const spot = scatter(rng, 17.5, 22, taken, 1.5)
        if (!spot) continue
        const face = Math.atan2(-spot.x, -spot.z)
        scenery.add(new BoxGeometry(1.8, 0.08, 0.5), '#8a5a3c', m4(spot.x, 0.48, spot.z, face))
        scenery.add(new BoxGeometry(1.8, 0.5, 0.07), '#8a5a3c', m4(spot.x, 0.78, spot.z, face).multiply(m4(0, 0, -0.22)))
        for (const sx of [-0.8, 0.8]) scenery.add(new BoxGeometry(0.07, 0.48, 0.45), '#3d3d3d', m4(spot.x, 0.24, spot.z, face).multiply(m4(sx, 0, 0)))
        taken.push({ ...spot, r: 1.2 })
      }
      for (let i = 0; i < 26; i++) {
        const spot = scatter(rng, 17.5, 26, taken, 0.4)
        if (!spot) continue
        scenery.add(new SphereGeometry(0.35, 8, 6).scale(1.4, 0.6, 1.4), '#4f8a3a', m4(spot.x, 0.2, spot.z))
        for (let k = 0; k < 5; k++) {
          scenery.add(new SphereGeometry(0.09, 6, 5), pick(['#ff595e', '#ffca3a', '#ff70a6', '#ffffff', '#8338ec'], rng), m4(spot.x + (rng() - 0.5) * 0.7, 0.38, spot.z + (rng() - 0.5) * 0.5))
        }
      }
      break
    }
    case 'beach': {
      // The sea along +z, with a lighter shore band.
      scenery.add(new PlaneGeometry(600, 300).rotateX(-Math.PI / 2), '#2f8fc9', m4(0, 0.03, 175))
      scenery.add(new PlaneGeometry(600, 6).rotateX(-Math.PI / 2), '#8fd3f4', m4(0, 0.04, 26))
      for (let i = 0; i < 18; i++) {
        const spot = scatter(rng, 18, 40, taken, 2.5)
        if (!spot || spot.z > 18) continue
        addTree(scenery, rng, spot.x, spot.z, 'palm', 1.15)
        taken.push({ ...spot, r: 1.5 })
      }
      for (let i = 0; i < 6; i++) {
        const spot = scatter(rng, 18, 26, taken, 2)
        if (!spot || spot.z > 18) continue
        scenery.add(new CylinderGeometry(0.04, 0.04, 2.2, 6), '#eeeeee', m4(spot.x, 1.1, spot.z))
        scenery.add(new ConeGeometry(1.3, 0.6, 10), pick(['#ef476f', '#ffd166', '#06d6a0', '#118ab2'], rng), m4(spot.x, 2.2, spot.z))
        taken.push({ ...spot, r: 1.3 })
      }
      for (let i = 0; i < 5; i++) {
        const spot = scatter(rng, 26, 36, taken, 5)
        if (!spot || spot.z > 10) continue
        addHouse(scenery, rng, spot.x, spot.z, 'beach', night)
        taken.push({ ...spot, r: 3 })
      }
      break
    }
    case 'city': {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + rng() * 0.08
        const r = 30 + rng() * 10
        const x = Math.cos(a) * r * 1.2
        const z = Math.sin(a) * r
        const w = 7 + rng() * 6
        const h = 10 + rng() * 26
        const face = Math.atan2(-x, -z)
        const wall = pick(['#c9c2b8', '#a6b1bd', '#d8cbbb', '#8e9aa6', '#b7a99a', '#d1d6dc'], rng)
        scenery.add(new BoxGeometry(w, h, 7), wall, m4(x, h / 2, z, face))
        const win = night ? '#ffd27a' : '#5b7183'
        const base = m4(x, 0, z, face)
        for (let fy = 2.2; fy < h - 1; fy += 2.6) {
          for (let fx = -w / 2 + 1; fx < w / 2 - 0.6; fx += 1.6) {
            if (night && rng() < 0.35) continue
            scenery.add(new BoxGeometry(0.8, 1.1, 0.05), win, base.clone().multiply(m4(fx + 0.4, fy, 3.53)))
          }
        }
      }
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        const x = Math.cos(a) * 19 * 1.2
        const z = Math.sin(a) * 19
        scenery.add(new CylinderGeometry(0.07, 0.09, 4.2, 6), '#3a3f45', m4(x, 2.1, z))
        scenery.add(new SphereGeometry(0.25, 8, 6), night ? '#fff3c4' : '#e8e8e8', m4(x, 4.3, z))
        addTree(scenery, rng, Math.cos(a + 0.3) * 21 * 1.2, Math.sin(a + 0.3) * 21, 'round', 0.8)
      }
      break
    }
    case 'snow': {
      for (let i = 0; i < 10; i++) {
        const spot = scatter(rng, 22, 34, taken, 5.5)
        if (!spot) continue
        addHouse(scenery, rng, spot.x, spot.z, 'snow', night)
        taken.push({ ...spot, r: 3 })
      }
      for (let i = 0; i < 44; i++) {
        const spot = scatter(rng, 18, 50, taken, 2)
        if (!spot) continue
        addTree(scenery, rng, spot.x, spot.z, 'pine', 1.2)
        taken.push({ ...spot, r: 1.4 })
      }
      for (let i = 0; i < 3; i++) {
        const spot = scatter(rng, 18, 24, taken, 1.5)
        if (!spot) continue
        scenery.add(new SphereGeometry(0.6, 12, 10), '#ffffff', m4(spot.x, 0.55, spot.z))
        scenery.add(new SphereGeometry(0.42, 12, 10), '#ffffff', m4(spot.x, 1.35, spot.z))
        scenery.add(new SphereGeometry(0.3, 12, 10), '#ffffff', m4(spot.x, 1.95, spot.z))
        scenery.add(new ConeGeometry(0.06, 0.3, 6).rotateX(Math.PI / 2), '#f77f00', m4(spot.x, 1.95, spot.z + 0.32))
        taken.push({ ...spot, r: 1 })
      }
      break
    }
  }
  // Distant hills/rocks on the horizon for depth.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rng() * 0.2
    const r = 150 + rng() * 60
    const size = 18 + rng() * 22
    scenery.add(new DodecahedronGeometry(size, 1).scale(1.6, 0.55, 1.2), PALETTES[place].hills, m4(Math.cos(a) * r, -size * 0.12, Math.sin(a) * r, rng()))
  }

  const sceneryMat = toon('#ffffff', { vertexColors: true })
  const mesh = scenery.build(sceneryMat)
  if (mesh) {
    group.add(mesh)
    geometries.push(mesh.geometry)
  }
  materials.push(sceneryMat)
  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
    },
  }
}
