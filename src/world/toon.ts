import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  type Material,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * The look of the 3D worlds: toon (cel) shading — flat color bands with soft
 * shadows — like an animated film. Static scenery is merged into a few big
 * meshes with per-vertex colors so a whole village draws in a handful of calls.
 */

let ramp: DataTexture | null = null

/** Four light bands: shadow, mid, lit, highlight. */
export function toonRamp(): DataTexture {
  if (ramp) return ramp
  const t = new DataTexture(new Uint8Array([70, 140, 205, 255]), 4, 1, RedFormat)
  t.minFilter = NearestFilter
  t.magFilter = NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  ramp = t
  return t
}

export function toon(color: string | number, options: { vertexColors?: boolean } = {}): MeshToonMaterial {
  return new MeshToonMaterial({ color: new Color(color), gradientMap: toonRamp(), vertexColors: options.vertexColors ?? false })
}

/** Paint every vertex of a geometry one color (non-indexed or indexed alike). */
export function paint(geometry: BufferGeometry, color: string | number | Color, jitter = 0, rng?: () => number): BufferGeometry {
  const c = color instanceof Color ? color : new Color(color)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const j = jitter && rng ? 1 + (rng() - 0.5) * jitter : 1
    colors[i * 3] = c.r * j
    colors[i * 3 + 1] = c.g * j
    colors[i * 3 + 2] = c.b * j
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geometry
}

/** Collects colored, transformed pieces of scenery and merges them into one mesh. */
export class Batch {
  private parts: BufferGeometry[] = []

  add(geometry: BufferGeometry, color: string | number | Color, matrix?: Matrix4): void {
    const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()) as BufferGeometry
    // Merging needs identical attribute sets: keep position, normal, color.
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    if (matrix) g.applyMatrix4(matrix)
    paint(g, color)
    this.parts.push(g)
  }

  get size(): number {
    return this.parts.length
  }

  build(material: Material, options: { shadows?: 'cast' | 'receive' | 'both' | 'none' } = {}): Mesh | null {
    if (!this.parts.length) return null
    const merged = mergeGeometries(this.parts, false)
    for (const p of this.parts) p.dispose()
    this.parts = []
    if (!merged) return null
    merged.computeBoundingSphere()
    const mesh = new Mesh(merged, material)
    const s = options.shadows ?? 'both'
    mesh.castShadow = s === 'cast' || s === 'both'
    mesh.receiveShadow = s === 'receive' || s === 'both'
    return mesh
  }
}

/**
 * An "inverted hull" outline: the geometry pushed out along its normals,
 * drawn back-faces only in a dark color — the ink line of a cartoon.
 */
export function outlineGeometry(geometry: BufferGeometry, thickness: number): BufferGeometry {
  const g = geometry.clone()
  const pos = g.getAttribute('position') as BufferAttribute
  const nor = g.getAttribute('normal') as BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + nor.getX(i) * thickness, pos.getY(i) + nor.getY(i) * thickness, pos.getZ(i) + nor.getZ(i) * thickness)
  }
  pos.needsUpdate = true
  return g
}
