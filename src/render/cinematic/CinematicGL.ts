import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  CustomBlending,
  DataTexture,
  DataUtils,
  DoubleSide,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  Points,
  RawShaderMaterial,
  RedFormat,
  RGBAFormat,
  Scene,
  SrcAlphaFactor,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  ZeroFactor,
  type IUniform,
} from 'three'
import type { Atmosphere, CinematicSettings, LookSettings } from '@/core/types'
import { featherMask } from '@/ai/vision/cutoutPost'
import { createRng } from '@/lib/math'
import { CUTOUT_VERSION, type CutoutActor, type DepthAnalysis, type SubjectCutout } from '@/storage/db'
import type { AnyCanvas } from '../types'
import type { CameraState } from './camera'
import { GRADES } from './grades'
import {
  BLUR_FRAG,
  BRIGHT_FRAG,
  COPY_FRAG,
  DOF_FRAG,
  FULLSCREEN_VERT,
  GRADE_FRAG,
  PARALLAX_FRAG,
  PARTICLE_FRAG,
  PARTICLE_VERT,
  SHADOW_FRAG,
  SHADOW_VERT,
  SUBJECT_FRAG,
  SUBJECT_VERT,
} from './shaders'
import { PropLayer, type BallDraw } from './PropLayer'
import { ballAt } from './props'
import { actorPose, type ActorPose } from './subject'

const RT_COPY_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSource;
void main() { fragColor = texture(uSource, vUv); }
`

const PARTICLE_KIND: Record<Exclude<Atmosphere, 'none'>, number> = { dust: 1, snow: 2, rain: 3, fireflies: 4, embers: 5, sparkles: 6 }
const PARTICLE_COUNT: Record<Exclude<Atmosphere, 'none'>, number> = { dust: 140, snow: 320, rain: 420, fireflies: 70, embers: 160, sparkles: 90 }

export interface ShotInput {
  width: number
  height: number
  image: { source: TexImageSource; width: number; height: number }
  depth: DepthAnalysis
  camera: CameraState
  /** Seconds since the shot became visible (drives every animation). */
  time: number
  /** Length of the shot in seconds (times one-off actions such as a kick). */
  duration: number
  settings: CinematicSettings
  /** Focus plane as disparity, or null for no depth of field. */
  focus: number | null
  look: LookSettings
  /** Visible part of the image (normalized), already matching the frame's aspect ratio; default = cover. */
  crop?: { x: number; y: number; width: number; height: number }
}

export interface LookInput {
  width: number
  height: number
  source: TexImageSource
  time: number
  look: LookSettings
}

/** Tiny LRU so GPU textures for media that's no longer on screen get freed. */
class TextureCache<V extends { dispose(): void }> {
  private map = new Map<object, V>()
  private readonly limit: number
  constructor(limit: number) {
    this.limit = limit
  }
  get(key: object, make: () => V): V {
    let value = this.map.get(key)
    if (value) {
      this.map.delete(key)
      this.map.set(key, value)
      return value
    }
    value = make()
    this.map.set(key, value)
    while (this.map.size > this.limit) {
      const [oldKey, old] = this.map.entries().next().value as [object, V]
      old.dispose()
      this.map.delete(oldKey)
    }
    return value
  }
  clear() {
    for (const v of this.map.values()) v.dispose()
    this.map.clear()
  }
}

interface DepthTextures {
  depth: DataTexture
  bgDepth: DataTexture
  fill: DataTexture
  hole: DataTexture
  far: DataTexture
  haze: Vector3
  dispose(): void
}

/** The depth layers the parallax pass reads (the original picture's, or the clean plate's). */
interface DepthLayers {
  width: number
  height: number
  depth: ArrayBuffer
  bgDepth: ArrayBuffer
  fill: ArrayBuffer
  hole: ArrayBuffer
  far: ArrayBuffer
}

interface CutoutTextures {
  plate: DataTexture
  plateMask: DataTexture
  matte: DataTexture
  labels: DataTexture
  layers: DepthTextures
  /** One grid per actor, drawn twice: color pass and depth pass. */
  actors: { actor: CutoutActor; geometry: BufferGeometry; color: Mesh; depth: Mesh }[]
  dispose(): void
}

/** A usable cut-out (current format, with at least one actor), or null. */
export function usableCutout(depth: DepthAnalysis): SubjectCutout | null {
  const cut = depth.cutout
  return cut && cut.version === CUTOUT_VERSION && cut.actors.length > 0 ? cut : null
}

function setupDataTexture(t: DataTexture, filter: typeof LinearFilter | typeof NearestFilter = LinearFilter): DataTexture {
  t.flipY = false
  t.colorSpace = NoColorSpace
  t.minFilter = filter
  t.magFilter = filter
  t.generateMipmaps = false
  t.wrapS = ClampToEdgeWrapping
  t.wrapT = ClampToEdgeWrapping
  t.needsUpdate = true
  return t
}

/** A grid over the actor's box (with a little room for its soft edge); position.xy = picture uv. */
function actorGrid(actor: CutoutActor): BufferGeometry {
  const pad = 0.012
  const x0 = Math.max(0, actor.box[0] - pad)
  const y0 = Math.max(0, actor.box[1] - pad)
  const x1 = Math.min(1, actor.box[0] + actor.box[2] + pad)
  const y1 = Math.min(1, actor.box[1] + actor.box[3] + pad)
  const nx = 24
  const ny = 40
  const positions = new Float32Array((nx + 1) * (ny + 1) * 3)
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = (j * (nx + 1) + i) * 3
      positions[k] = x0 + ((x1 - x0) * i) / nx
      positions[k + 1] = y0 + ((y1 - y0) * j) / ny
    }
  }
  const index: number[] = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i
      index.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(index)
  return geometry
}

const tex = () => ({ value: null as Texture | null })

function material(fragmentShader: string, uniforms: Record<string, IUniform>): RawShaderMaterial {
  return new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending: NoBlending })
}

function makeTarget(width: number, height: number): WebGLRenderTarget {
  return new WebGLRenderTarget(width, height, {
    type: UnsignedByteType,
    format: RGBAFormat,
    depthBuffer: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
  })
}

/** Average color of the far region (falls back to the top of the frame), mixed toward a pale sky tone. */
function hazeColor(image: TexImageSource, depth: DepthAnalysis): Vector3 {
  const size = 32
  try {
    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image as CanvasImageSource, 0, 0, size, size)
    const px = ctx.getImageData(0, 0, size, size).data
    const far = new Uint8Array(depth.far)
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = Math.floor((x / size) * depth.width)
        const fy = Math.floor((y / size) * depth.height)
        const inFar = far[fy * depth.width + fx] === 1
        if (inFar || (n === 0 && y < size * 0.3)) {
          const i = (y * size + x) * 4
          r += px[i]!
          g += px[i + 1]!
          b += px[i + 2]!
          n++
        }
      }
    }
    if (n === 0) return new Vector3(0.78, 0.82, 0.88)
    return new Vector3(0.6 * (r / n / 255) + 0.4 * 0.8, 0.6 * (g / n / 255) + 0.4 * 0.83, 0.6 * (b / n / 255) + 0.4 * 0.88)
  } catch {
    return new Vector3(0.78, 0.82, 0.88)
  }
}

/** GPU textures for a set of depth layers (half-float depth, color fill, feathered masks). */
function layerTextures(layers: DepthLayers, haze: Vector3): DepthTextures {
  const { width, height } = layers
  const toHalf = (buffer: ArrayBuffer) => {
    const src = new Uint16Array(buffer)
    const half = new Uint16Array(src.length)
    for (let i = 0; i < src.length; i++) half[i] = DataUtils.toHalfFloat(src[i]! / 65535)
    return setupDataTexture(new DataTexture(half, width, height, RedFormat, HalfFloatType))
  }
  const depth = toHalf(layers.depth)
  const bgDepth = toHalf(layers.bgDepth)
  const fill = setupDataTexture(new DataTexture(new Uint8Array(layers.fill), width, height, RGBAFormat, UnsignedByteType))
  const hole = setupDataTexture(new DataTexture(featherMask(new Uint8Array(layers.hole), width, height, 1), width, height, RedFormat, UnsignedByteType))
  const far = setupDataTexture(new DataTexture(featherMask(new Uint8Array(layers.far), width, height), width, height, RedFormat, UnsignedByteType))
  return {
    depth,
    bgDepth,
    fill,
    hole,
    far,
    haze,
    dispose() {
      for (const t of [depth, bgDepth, fill, hole, far]) t.dispose()
    },
  }
}

/**
 * WebGL2 renderer for cinematic shots and film looks. Runs on the main thread
 * (preview) and inside the export worker with an OffscreenCanvas.
 */
export class CinematicGL {
  readonly canvas: AnyCanvas
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: Mesh
  private readonly mats: Record<'parallax' | 'copy' | 'rtCopy' | 'dof' | 'bright' | 'blur' | 'grade', RawShaderMaterial>
  private readonly particles = new Map<Exclude<Atmosphere, 'none'>, Points>()
  private targets: { a: WebGLRenderTarget; b: WebGLRenderTarget; bloomA: WebGLRenderTarget; bloomB: WebGLRenderTarget } | null = null
  private size = { width: 0, height: 0 }
  private readonly images = new TextureCache<Texture>(8)
  private readonly depths = new TextureCache<DepthTextures>(8)
  private readonly cutouts = new TextureCache<CutoutTextures>(4)
  private readonly flat: Texture
  /** Size of the picture last uploaded into `flat` (its GPU storage is fixed at that size). */
  private flatSize = { width: 0, height: 0 }
  /** 1×1 black: "no clean plate here". */
  private readonly none: DataTexture
  private readonly actorColor: RawShaderMaterial
  private readonly actorDepth: RawShaderMaterial
  private readonly shadow: Mesh
  private readonly propLayer: PropLayer
  private lost = false
  /** Unsharp-mask strength for the current shot (set from how much the picture is enlarged). */
  private sharpen = 0

  /** Create a renderer, or null when WebGL2 isn't available (callers fall back to 2D). */
  static create(createCanvas: (w: number, h: number) => AnyCanvas): CinematicGL | null {
    try {
      const canvas = createCanvas(2, 2)
      const context = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true })
      if (!context) return null
      return new CinematicGL(canvas, context as WebGL2RenderingContext)
    } catch {
      return null
    }
  }

  private constructor(canvas: AnyCanvas, context: WebGL2RenderingContext) {
    this.canvas = canvas
    this.renderer = new WebGLRenderer({ canvas: canvas as HTMLCanvasElement, context, antialias: false, alpha: false, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(1)
    this.renderer.autoClear = false
    if ('addEventListener' in canvas) {
      canvas.addEventListener('webglcontextlost', () => {
        this.lost = true
      })
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    this.mats = {
      parallax: material(PARALLAX_FRAG, {
        uImage: tex(),
        uPlate: tex(),
        uPlateMask: tex(),
        uDepth: tex(),
        uBgDepth: tex(),
        uFill: tex(),
        uHole: tex(),
        uFar: tex(),
        uDepthTexel: { value: new Vector2(1, 1) },
        uCropOrigin: { value: new Vector2(0, 0) },
        uCropSize: { value: new Vector2(1, 1) },
        uShift: { value: new Vector2() },
        uDolly: { value: 0 },
        uBase: { value: 1 },
        uPivot: { value: 0.5 },
        uTime: { value: 0 },
        uSky: { value: 0 },
        uFoliage: { value: 0 },
        uHaze: { value: 0 },
        uHazeColor: { value: new Vector3(0.8, 0.83, 0.88) },
        uSteps: { value: 48 },
      }),
      copy: material(COPY_FRAG, { uSource: tex() }),
      rtCopy: material(RT_COPY_FRAG, { uSource: tex() }),
      dof: material(DOF_FRAG, { uSource: tex(), uTexel: { value: new Vector2() }, uFocus: { value: 0.5 }, uMaxRadius: { value: 9 } }),
      bright: material(BRIGHT_FRAG, { uSource: tex() }),
      blur: material(BLUR_FRAG, { uSource: tex(), uDirection: { value: new Vector2() } }),
      grade: material(GRADE_FRAG, {
        uSource: tex(),
        uBloom: tex(),
        uBloomAmount: { value: 0 },
        uTemperature: { value: 0 },
        uTint: { value: 0 },
        uContrast: { value: 1 },
        uLift: { value: new Vector3() },
        uGamma: { value: new Vector3(1, 1, 1) },
        uGain: { value: new Vector3(1, 1, 1) },
        uSaturation: { value: 1 },
        uShadows: { value: new Vector3() },
        uHighlights: { value: new Vector3() },
        uFade: { value: 0 },
        uVignette: { value: 0 },
        uGrain: { value: 0 },
        uLetterbox: { value: 0 },
        uAspect: { value: 16 / 9 },
        uFrame: { value: 0 },
        uSharpen: { value: 0 },
        uTexel: { value: new Vector2() },
      }),
    }
    this.quad = new Mesh(geometry, this.mats.copy)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
    this.flat = new Texture()
    this.flat.flipY = false
    this.flat.colorSpace = NoColorSpace
    this.flat.generateMipmaps = false
    this.flat.minFilter = LinearFilter
    this.none = setupDataTexture(new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType))

    // Actors: color over the scene (keeping the depth in alpha), then their depth into alpha.
    const actorUniforms = (): Record<string, IUniform> => ({
      uImage: tex(),
      uMatte: tex(),
      uLabels: tex(),
      uLabel: { value: 1 },
      uCropOrigin: { value: new Vector2() },
      uCropSize: { value: new Vector2(1, 1) },
      uAspect: { value: 1 },
      uAnchor: { value: new Vector2() },
      uHeight: { value: 1 },
      uMove: { value: new Vector2() },
      uRotation: { value: 0 },
      uScale: { value: new Vector2(1, 1) },
      uBend: { value: 0 },
      uShift: { value: new Vector2() },
      uDolly: { value: 0 },
      uBase: { value: 1 },
      uPivot: { value: 0.5 },
      uLevel: { value: 0.5 },
      uHaze: { value: 0 },
      uHazeColor: { value: new Vector3() },
      uPass: { value: 0 },
    })
    const actorMaterial = (pass: 0 | 1) => {
      const u = actorUniforms()
      u.uPass!.value = pass
      return new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: SUBJECT_VERT,
        fragmentShader: SUBJECT_FRAG,
        uniforms: u,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        // Picture space is y-down, clip space y-up: the grid's winding flips, so draw both faces.
        side: DoubleSide,
        blending: CustomBlending,
        ...(pass === 0
          ? { blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor }
          : { blendSrc: ZeroFactor, blendDst: OneFactor, blendSrcAlpha: OneFactor, blendDstAlpha: ZeroFactor }),
      })
    }
    this.actorColor = actorMaterial(0)
    this.actorDepth = actorMaterial(1)
    const disc = new BufferGeometry()
    disc.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
    disc.setIndex([0, 1, 2, 0, 2, 3])
    this.shadow = new Mesh(
      disc,
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: SHADOW_VERT,
        fragmentShader: SHADOW_FRAG,
        uniforms: { uCenter: { value: new Vector2() }, uRadius: { value: new Vector2(0.1, 0.02) }, uStrength: { value: 0 } },
        depthTest: false,
        depthWrite: false,
        transparent: true,
        side: DoubleSide,
        // Darken the color underneath; keep the depth stored in alpha.
        blending: CustomBlending,
        blendSrc: ZeroFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneFactor,
      }),
    )
    this.shadow.frustumCulled = false
    this.propLayer = new PropLayer(this.renderer, this.scene, this.camera)
  }

  get available(): boolean {
    return !this.lost
  }

  private ensureSize(width: number, height: number) {
    if (this.size.width === width && this.size.height === height && this.targets) return
    this.size = { width, height }
    this.renderer.setSize(width, height, false)
    if (this.targets) for (const t of Object.values(this.targets)) t.dispose()
    const hw = Math.max(1, Math.round(width / 2))
    const hh = Math.max(1, Math.round(height / 2))
    this.targets = { a: makeTarget(width, height), b: makeTarget(width, height), bloomA: makeTarget(hw, hh), bloomB: makeTarget(hw, hh) }
  }

  private pass(mat: RawShaderMaterial, target: WebGLRenderTarget | null) {
    this.quad.material = mat
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }

  private imageTexture(source: TexImageSource): Texture {
    return this.images.get(source as object, () => {
      const t = new Texture(source as never)
      t.flipY = false
      t.colorSpace = NoColorSpace
      t.generateMipmaps = false
      t.minFilter = LinearFilter
      t.magFilter = LinearFilter
      t.wrapS = ClampToEdgeWrapping
      t.wrapT = ClampToEdgeWrapping
      t.needsUpdate = true
      return t
    })
  }

  private depthTextures(depth: DepthAnalysis, image: TexImageSource): DepthTextures {
    return this.depths.get(depth, () => layerTextures(depth, hazeColor(image, depth)))
  }

  private cutoutTextures(cut: SubjectCutout, depth: DepthAnalysis, haze: Vector3): CutoutTextures {
    return this.cutouts.get(cut, () => {
      const { width, height } = cut
      const plate = setupDataTexture(new DataTexture(new Uint8Array(cut.plate), width, height, RGBAFormat, UnsignedByteType))
      const plateMask = setupDataTexture(new DataTexture(new Uint8Array(cut.plateMask), width, height, RedFormat, UnsignedByteType))
      const matte = setupDataTexture(new DataTexture(new Uint8Array(cut.matte), width, height, RedFormat, UnsignedByteType))
      // Labels are ids: never interpolate them.
      const labels = setupDataTexture(new DataTexture(new Uint8Array(cut.labels), width, height, RedFormat, UnsignedByteType), NearestFilter)
      const layers = layerTextures(
        { width: depth.width, height: depth.height, depth: cut.plateDepth, bgDepth: cut.plateBgDepth, fill: cut.plateFill, hole: cut.plateHole, far: cut.plateFar },
        haze,
      )
      const actors = cut.actors.map((actor) => {
        const geometry = actorGrid(actor)
        const color = new Mesh(geometry, this.actorColor)
        const depthMesh = new Mesh(geometry, this.actorDepth)
        color.frustumCulled = false
        depthMesh.frustumCulled = false
        return { actor, geometry, color, depth: depthMesh }
      })
      return {
        plate,
        plateMask,
        matte,
        labels,
        layers,
        actors,
        dispose() {
          for (const t of [plate, plateMask, matte, labels]) t.dispose()
          layers.dispose()
          for (const a of actors) a.geometry.dispose()
        },
      }
    })
  }

  private particleSystem(kind: Exclude<Atmosphere, 'none'>): Points {
    let points = this.particles.get(kind)
    if (points) return points
    const count = PARTICLE_COUNT[kind]
    const rng = createRng(0x51ed + PARTICLE_KIND[kind] * 977)
    const seed = new Float32Array(count * 4)
    const motion = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      seed.set([rng(), rng(), 0.05 + rng() * 0.95, rng()], i * 4)
      motion.set([rng(), rng() * Math.PI * 2, rng(), rng()], i * 4)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 4))
    geometry.setAttribute('aMotion', new BufferAttribute(motion, 4))
    const additive = kind === 'fireflies' || kind === 'embers' || kind === 'sparkles'
    const mat = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uKind: { value: PARTICLE_KIND[kind] },
        uShift: { value: new Vector2() },
        uDolly: { value: 0 },
        uBase: { value: 1 },
        uPivot: { value: 0.5 },
        uPixelScale: { value: 1 },
        uSceneDepth: { value: null },
        uResolution: { value: new Vector2(1, 1) },
        uOcclude: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // Blend color, but keep the destination alpha: it carries per-pixel depth for later passes.
      blending: CustomBlending,
      blendSrc: SrcAlphaFactor,
      blendDst: additive ? OneFactor : OneMinusSrcAlphaFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    })
    points = new Points(geometry, mat)
    points.frustumCulled = false
    this.particles.set(kind, points)
    return points
  }

  /** Render a depth-parallax shot (with its look) to `canvas`. */
  renderShot(input: ShotInput): AnyCanvas {
    const { width, height } = input
    this.ensureSize(width, height)
    const t = this.targets!
    const original = this.depthTextures(input.depth, input.image.source)
    // With a cut-out, the background is the clean plate (and its depth); the actors are drawn on top.
    const cut = usableCutout(input.depth)
    const cutTex = cut ? this.cutoutTextures(cut, input.depth, original.haze) : null
    const maps = cutTex ? cutTex.layers : original
    const p = this.mats.parallax.uniforms
    const frameAspect = width / height
    const imageAspect = input.image.width / input.image.height
    const image = this.imageTexture(input.image.source)
    p.uImage!.value = image
    p.uPlate!.value = cutTex?.plate ?? this.none
    p.uPlateMask!.value = cutTex?.plateMask ?? this.none
    p.uDepth!.value = maps.depth
    p.uBgDepth!.value = maps.bgDepth
    p.uFill!.value = maps.fill
    p.uHole!.value = maps.hole
    p.uFar!.value = maps.far
    ;(p.uDepthTexel!.value as Vector2).set(1 / input.depth.width, 1 / input.depth.height)
    // The visible region of the image: an explicit crop, or a centered "cover" fit.
    const crop = input.crop ?? (() => {
      const w = imageAspect > frameAspect ? frameAspect / imageAspect : 1
      const h = imageAspect > frameAspect ? 1 : imageAspect / frameAspect
      return { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h }
    })()
    ;(p.uCropOrigin!.value as Vector2).set(crop.x, crop.y)
    ;(p.uCropSize!.value as Vector2).set(crop.width, crop.height)
    ;(p.uShift!.value as Vector2).set(input.camera.shiftX, input.camera.shiftY)
    p.uDolly!.value = input.camera.dolly
    p.uBase!.value = input.camera.base
    p.uPivot!.value = input.camera.pivot
    p.uTime!.value = input.time
    p.uSky!.value = input.settings.animateSky ? 1 : 0
    p.uFoliage!.value = input.settings.foliage ? 1 : 0
    p.uHaze!.value = input.settings.haze
    ;(p.uHazeColor!.value as Vector3).copy(maps.haze)
    // Enough march steps to resolve the largest on-screen displacement in pixels.
    const travel = (Math.abs(input.camera.shiftX) + Math.abs(input.camera.shiftY) + input.camera.dolly * 0.5) * Math.max(width, height)
    p.uSteps!.value = Math.min(96, Math.max(16, Math.ceil(travel / 1.5)))
    // Output pixels per source pixel: above ~1.3× enlargement, sharpen gently.
    const enlarge = width / Math.max(1, crop.width * input.image.width)
    this.sharpen = Math.min(0.6, Math.max(0, (enlarge - 1.3) * 0.35))
    this.pass(this.mats.parallax, t.a)
    const actors = cutTex ? this.drawActors(input, cutTex, image, crop, t.a) : []
    let current = t.a
    const props = input.settings.props
    if (props.length) {
      // The football plays with the main (largest) actor; without a cut-out there is no one to play with.
      const main = actors.find((a) => a.actor.label === 1)
      let ball: BallDraw | null = null
      if (main && props.includes('football')) {
        ball = {
          state: ballAt({
            action: input.settings.subject.action,
            direction: input.settings.subject.direction === 'left' ? -1 : 1,
            time: input.time,
            duration: input.duration,
            anchor: main.anchor,
            height: main.height,
            width: main.width,
            pose: main.pose,
            aspect: frameAspect,
          }),
          level: main.actor.depth,
          actorHeight: main.height,
        }
      }
      // Props test against the scene's depth (t.a) while drawing into a copy of it (t.b).
      this.mats.rtCopy.uniforms.uSource!.value = t.a.texture
      this.pass(this.mats.rtCopy, t.b)
      this.quad.visible = false
      this.propLayer.draw({ target: t.b, sceneDepth: t.a.texture, width, height, time: input.time, camera: input.camera, props, ambient: maps.haze, ball })
      this.quad.visible = true
      current = t.b
    }
    return this.finish(current, input.look, input.time, width, height, input.focus, input.camera, true)
  }

  /**
   * Cut-out subjects over the clean plate: contact shadows, then each actor's
   * color and depth. Returns where each actor is (for props that interact).
   */
  private drawActors(
    input: ShotInput,
    textures: CutoutTextures,
    image: Texture,
    crop: { x: number; y: number; width: number; height: number },
    target: WebGLRenderTarget,
  ): { actor: CutoutActor; pose: ActorPose; anchor: { x: number; y: number }; height: number; width: number }[] {
    const { camera, settings } = input
    const aspect = input.width / input.height
    const subject = settings.subject
    const dir = subject.direction === 'left' ? -1 : 1
    const magnify = (d: number) => (camera.base * (1 + camera.dolly * d)) / (1 + camera.dolly * camera.pivot)
    // Nearer (lower in the frame) actors are drawn last, so they overlap the others.
    const order = textures.actors.map((a, i) => ({ ...a, index: i })).toSorted((a, b) => a.actor.anchor[1] - b.actor.anchor[1])
    const pictureAspect = input.image.width / input.image.height
    const poses = order.map(({ actor, index }) => {
      // Room to travel before the actor's leading edge leaves the visible frame (plus a tenth of its width), in actor heights.
      const [bx, , bw, bh] = actor.box
      const ahead = dir > 0 ? crop.x + crop.width - (bx + bw) : bx - crop.x
      const room = ((ahead + bw * 0.1) * pictureAspect) / bh
      return actorPose({
        action: subject.action,
        amount: subject.amount,
        direction: dir,
        time: input.time,
        duration: input.duration,
        phase: index * 0.31,
        edges: actor.edges,
        room,
      })
    })
    const frame = (a: CutoutActor) => ({
      anchor: new Vector2((a.anchor[0] - crop.x) / crop.width, (a.anchor[1] - crop.y) / crop.height),
      height: a.box[3] / crop.height,
      width: a.box[2] / crop.width,
    })
    this.renderer.setRenderTarget(target)
    this.quad.visible = false

    if (subject.action !== 'none') {
      const su = (this.shadow.material as RawShaderMaterial).uniforms
      this.scene.add(this.shadow)
      order.forEach(({ actor }, k) => {
        if (actor.edges.bottom) return
        const pose = poses[k]!
        const f = frame(actor)
        const level = actor.depth + pose.depth
        const m = magnify(level)
        // The shadow stays on the ground under the actor's feet (it follows travel, not jumps).
        const ground = { x: f.anchor.x + (pose.tx * f.height) / aspect, y: f.anchor.y }
        ;(su.uCenter!.value as Vector2).set(0.5 + (ground.x - 0.5) * m + camera.shiftX * (level - camera.pivot), 0.5 + (ground.y - 0.5) * m + camera.shiftY * (level - camera.pivot))
        const spread = 1 + 0.5 * (1 - pose.contact)
        const rx = 0.42 * f.width * m * spread
        ;(su.uRadius!.value as Vector2).set(rx, rx * aspect * 0.16)
        su.uStrength!.value = 0.3 * (0.35 + 0.65 * pose.contact)
        this.renderer.render(this.scene, this.camera)
      })
      this.scene.remove(this.shadow)
    }

    for (const mat of [this.actorColor, this.actorDepth]) {
      const u = mat.uniforms
      u.uImage!.value = image
      u.uMatte!.value = textures.matte
      u.uLabels!.value = textures.labels
      ;(u.uCropOrigin!.value as Vector2).set(crop.x, crop.y)
      ;(u.uCropSize!.value as Vector2).set(crop.width, crop.height)
      u.uAspect!.value = aspect
      ;(u.uShift!.value as Vector2).set(camera.shiftX, camera.shiftY)
      u.uDolly!.value = camera.dolly
      u.uBase!.value = camera.base
      u.uPivot!.value = camera.pivot
      u.uHaze!.value = settings.haze
      ;(u.uHazeColor!.value as Vector3).copy(textures.layers.haze)
    }
    order.forEach(({ actor, color, depth }, k) => {
      const pose = poses[k]!
      const f = frame(actor)
      for (const mesh of [color, depth]) {
        const u = (mesh.material as RawShaderMaterial).uniforms
        u.uLabel!.value = actor.label
        ;(u.uAnchor!.value as Vector2).copy(f.anchor)
        u.uHeight!.value = f.height
        ;(u.uMove!.value as Vector2).set(pose.tx, pose.ty)
        u.uRotation!.value = pose.rotation
        ;(u.uScale!.value as Vector2).set(pose.sx, pose.sy)
        u.uBend!.value = pose.bend
        u.uLevel!.value = Math.min(1, actor.depth + pose.depth)
        this.scene.add(mesh)
        this.renderer.render(this.scene, this.camera)
        this.scene.remove(mesh)
      }
    })
    this.quad.visible = true
    return order.map(({ actor }, k) => {
      const f = frame(actor)
      return { actor, pose: poses[k]!, anchor: { x: f.anchor.x, y: f.anchor.y }, height: f.height, width: f.width }
    })
  }

  /** Apply a look (grade, particles, bloom, lens) to a flat 2D picture. */
  renderLook(input: LookInput): AnyCanvas {
    const { width, height } = input
    this.ensureSize(width, height)
    // GPU texture storage is allocated once at the first upload's size: when the picture's
    // size changes (e.g. the preview resized), free it so the next upload reallocates —
    // otherwise every later upload fails and the look keeps showing the first frame.
    const { width: sw, height: sh } = input.source as { width: number; height: number }
    if (sw !== this.flatSize.width || sh !== this.flatSize.height) {
      this.flat.dispose()
      this.flatSize = { width: sw, height: sh }
    }
    this.flat.image = input.source as never
    this.flat.needsUpdate = true
    this.mats.copy.uniforms.uSource!.value = this.flat
    this.sharpen = 0
    this.pass(this.mats.copy, this.targets!.a)
    return this.finish(this.targets!.a, input.look, input.time, width, height, null, null, false)
  }

  private finish(
    source: WebGLRenderTarget,
    look: LookSettings,
    time: number,
    width: number,
    height: number,
    focus: number | null,
    camera: CameraState | null,
    hasDepth: boolean,
  ): AnyCanvas {
    const t = this.targets!
    let current = source
    const other = () => (current === t.a ? t.b : t.a)
    const short = Math.min(width, height)

    if (look.atmosphere !== 'none') {
      const target = other()
      this.mats.rtCopy.uniforms.uSource!.value = current.texture
      this.pass(this.mats.rtCopy, target)
      const points = this.particleSystem(look.atmosphere)
      const u = (points.material as RawShaderMaterial).uniforms
      u.uTime!.value = time
      ;(u.uShift!.value as Vector2).set(camera?.shiftX ?? 0, camera?.shiftY ?? 0)
      u.uDolly!.value = camera?.dolly ?? 0
      u.uBase!.value = camera?.base ?? 1
      u.uPivot!.value = camera?.pivot ?? 0.5
      u.uPixelScale!.value = short / 720
      u.uSceneDepth!.value = current.texture
      ;(u.uResolution!.value as Vector2).set(width, height)
      u.uOcclude!.value = hasDepth ? 1 : 0
      this.scene.add(points)
      this.quad.visible = false
      this.renderer.setRenderTarget(target)
      this.renderer.render(this.scene, this.camera)
      this.quad.visible = true
      this.scene.remove(points)
      current = target
    }

    if (focus !== null && hasDepth) {
      const target = other()
      const d = this.mats.dof.uniforms
      d.uSource!.value = current.texture
      ;(d.uTexel!.value as Vector2).set(1 / width, 1 / height)
      d.uFocus!.value = focus
      d.uMaxRadius!.value = 9 * (short / 720)
      this.pass(this.mats.dof, target)
      current = target
    }

    const g = this.mats.grade.uniforms
    if (look.bloom > 0) {
      this.mats.bright.uniforms.uSource!.value = current.texture
      this.pass(this.mats.bright, t.bloomA)
      for (let i = 0; i < 2; i++) {
        const spread = 1 + i
        this.mats.blur.uniforms.uSource!.value = t.bloomA.texture
        ;(this.mats.blur.uniforms.uDirection!.value as Vector2).set(spread / t.bloomA.width, 0)
        this.pass(this.mats.blur, t.bloomB)
        this.mats.blur.uniforms.uSource!.value = t.bloomB.texture
        ;(this.mats.blur.uniforms.uDirection!.value as Vector2).set(0, spread / t.bloomA.height)
        this.pass(this.mats.blur, t.bloomA)
      }
      g.uBloom!.value = t.bloomA.texture
      g.uBloomAmount!.value = look.bloom * 1.1
    } else {
      g.uBloom!.value = current.texture
      g.uBloomAmount!.value = 0
    }

    const grade = GRADES[look.grade]
    g.uSource!.value = current.texture
    g.uTemperature!.value = grade.temperature
    g.uTint!.value = grade.tint
    g.uContrast!.value = grade.contrast
    ;(g.uLift!.value as Vector3).fromArray(grade.lift)
    ;(g.uGamma!.value as Vector3).fromArray(grade.gamma)
    ;(g.uGain!.value as Vector3).fromArray(grade.gain)
    g.uSaturation!.value = grade.saturation
    ;(g.uShadows!.value as Vector3).fromArray(grade.shadows)
    ;(g.uHighlights!.value as Vector3).fromArray(grade.highlights)
    g.uFade!.value = grade.fade
    g.uVignette!.value = look.vignette
    g.uGrain!.value = look.grain
    const aspect = width / height
    g.uLetterbox!.value = look.letterbox && aspect >= 1 ? Math.max(0.06, (1 - aspect / 2.39) / 2) : 0
    g.uAspect!.value = aspect
    g.uFrame!.value = Math.floor(time * 24)
    g.uSharpen!.value = this.sharpen
    ;(g.uTexel!.value as Vector2).set(1 / width, 1 / height)
    this.pass(this.mats.grade, null)
    return this.canvas
  }

  dispose(): void {
    this.propLayer.dispose()
    this.images.clear()
    this.depths.clear()
    this.cutouts.clear()
    this.none.dispose()
    this.actorColor.dispose()
    this.actorDepth.dispose()
    this.shadow.geometry.dispose()
    ;(this.shadow.material as RawShaderMaterial).dispose()
    if (this.targets) for (const t of Object.values(this.targets)) t.dispose()
    for (const m of Object.values(this.mats)) m.dispose()
    for (const p of this.particles.values()) {
      p.geometry.dispose()
      ;(p.material as RawShaderMaterial).dispose()
    }
    this.quad.geometry.dispose()
    this.flat.dispose()
    this.renderer.dispose()
    // Release the WebGL context now rather than whenever the GC gets to it (browsers cap live contexts).
    this.renderer.forceContextLoss()
  }
}
