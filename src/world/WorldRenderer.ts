import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type ShaderMaterial,
} from 'three'
import type { WorldBackground, WorldSpec } from '@/core/types'
import type { AnyCanvas } from '@/render/types'
import { cameraFor } from './camera'
import { buildCharacter, type Character } from './character'
import { buildChoreography, type Choreography } from './choreography'
import { buildPlace, type Place } from './places'
import { createSky, lightingFor, type Lighting } from './sky'
import { toon } from './toon'

/**
 * Renders live 3D shots: builds a world (place, sky, light, characters,
 * ball) once per story and films it — every frame a pure function of story
 * time and the shot's camera rig, so the preview and the export match.
 * Runs on the main thread (preview) and in the export worker (OffscreenCanvas).
 */

export interface WorldRenderInput {
  width: number
  height: number
  background: WorldBackground
  /** Seconds since the shot became visible. */
  time: number
  /** Length of the shot (s). */
  duration: number
}

interface BuiltWorld {
  scene: Scene
  choreo: Choreography
  characters: Character[]
  ball: Mesh | null
  sky: Mesh & { material: ShaderMaterial }
  place: Place
  lighting: Lighting
  extra: Material[]
  dispose(): void
}

/** Key for the parts of a spec that change what is built or how it moves. */
export function worldKey(spec: WorldSpec): string {
  return JSON.stringify([spec.seed, spec.place, spec.time, spec.weather, spec.activity, spec.cast, spec.beats])
}

/** A football: a sphere with flat black pentagon patches around the 12 icosahedron vertices. */
function footballGeometry(radius: number) {
  const g = new IcosahedronGeometry(radius, 3)
  const pos = g.getAttribute('position')
  const phi = (1 + Math.sqrt(5)) / 2
  const centers = [
    [0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi],
    [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0],
    [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1],
  ].map(([x, y, z]) => new Vector3(x, y, z).normalize())
  const colors = new Float32Array(pos.count * 3)
  const c = new Vector3()
  for (let i = 0; i < pos.count; i += 3) {
    c.set(0, 0, 0)
    for (let k = 0; k < 3; k++) c.add(new Vector3(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)))
    c.normalize()
    const black = centers.some((p) => p.dot(c) > Math.cos(0.33))
    const v = black ? 0.06 : 0.95
    for (let k = 0; k < 3; k++) colors.set([v, v, v], (i + k) * 3)
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return g
}

export class WorldRenderer {
  readonly canvas: AnyCanvas
  private readonly renderer: WebGLRenderer
  private readonly camera = new PerspectiveCamera(45, 16 / 9, 0.1, 1200)
  private readonly worlds = new Map<string, BuiltWorld>()
  private size = { width: 0, height: 0 }
  private lost = false

  /** Create a renderer, or null without WebGL2. */
  static create(createCanvas: (w: number, h: number) => AnyCanvas): WorldRenderer | null {
    try {
      const canvas = createCanvas(2, 2)
      const context = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
      if (!context) return null
      return new WorldRenderer(canvas, context as WebGL2RenderingContext)
    } catch {
      return null
    }
  }

  private constructor(canvas: AnyCanvas, context: WebGL2RenderingContext) {
    this.canvas = canvas
    this.renderer = new WebGLRenderer({ canvas: canvas as HTMLCanvasElement, context, antialias: true, alpha: false, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(1)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    if ('addEventListener' in canvas) {
      canvas.addEventListener('webglcontextlost', () => {
        this.lost = true
      })
    }
  }

  get available(): boolean {
    return !this.lost
  }

  /** The story's choreography (for tests and tools). */
  choreography(spec: WorldSpec): Choreography {
    return this.world(spec).choreo
  }

  private world(spec: WorldSpec): BuiltWorld {
    const key = worldKey(spec)
    const cached = this.worlds.get(key)
    if (cached) {
      this.worlds.delete(key)
      this.worlds.set(key, cached)
      return cached
    }
    const built = this.build(spec)
    this.worlds.set(key, built)
    while (this.worlds.size > 2) {
      const [oldKey, old] = this.worlds.entries().next().value as [string, BuiltWorld]
      old.dispose()
      this.worlds.delete(oldKey)
    }
    return built
  }

  private build(spec: WorldSpec): BuiltWorld {
    const choreo = buildChoreography(spec)
    const lighting = lightingFor(spec.time, spec.weather)
    const scene = new Scene()
    scene.fog = new Fog(lighting.fog, lighting.fogNear, lighting.fogFar)
    scene.background = new Color(lighting.horizon)
    const hemi = new HemisphereLight(lighting.hemiSky, lighting.hemiGround, lighting.hemiIntensity)
    scene.add(hemi)
    const sun = new DirectionalLight(lighting.sunColor, lighting.sunIntensity)
    sun.position.copy(lighting.sun).multiplyScalar(80)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const cam = sun.shadow.camera
    cam.left = -30
    cam.right = 30
    cam.top = 30
    cam.bottom = -30
    cam.near = 1
    cam.far = 200
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.04
    scene.add(sun)
    scene.add(sun.target)

    const place = buildPlace(spec.place, spec.time, choreo.pitch, spec.seed, spec.activity === 'football')
    scene.add(place.group)
    const sky = createSky(lighting)
    scene.add(sky)

    const characters = spec.cast.map((c) => buildCharacter(c.kind, c.look))
    for (const ch of characters) scene.add(ch.root)

    const extra: Material[] = []
    let ball: Mesh | null = null
    if (spec.activity === 'football') {
      const mat = toon('#ffffff', { vertexColors: true })
      extra.push(mat)
      ball = new Mesh(footballGeometry(0.11), mat)
      ball.castShadow = true
      scene.add(ball)
    }
    return {
      scene,
      choreo,
      characters,
      ball,
      sky,
      place,
      lighting,
      extra,
      dispose() {
        place.dispose()
        for (const ch of characters) ch.dispose()
        sky.geometry.dispose()
        sky.material.dispose()
        ball?.geometry.dispose()
        for (const m of extra) m.dispose()
        sun.dispose()
      },
    }
  }

  /** Render one frame of a shot. */
  render(input: WorldRenderInput): AnyCanvas {
    const { width, height, background: bg } = input
    const w = this.world(bg.world)
    const storyTime = bg.start + input.time
    const now = w.choreo.frame(storyTime)
    const start = w.choreo.frame(bg.start)
    now.actors.forEach((a, i) => w.characters[i]?.update(a.pose, a.x, a.z, a.heading, storyTime, a.phase, a.speed))
    if (w.ball && now.ball) {
      w.ball.position.set(now.ball.x, now.ball.y, now.ball.z)
      w.ball.quaternion.set(...now.ball.q)
    }
    w.sky.material.uniforms.uTime!.value = storyTime
    const shot = cameraFor({
      shot: bg.shot,
      progress: input.duration > 0 ? Math.min(1, Math.max(0, input.time / input.duration)) : 0,
      time: input.time,
      now,
      start,
      pitch: w.choreo.pitch,
      heroHeight: w.characters[0]?.height ?? 1.3,
    })
    this.camera.position.set(...shot.position)
    this.camera.lookAt(...shot.target)
    this.camera.fov = shot.fov
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    w.sky.position.copy(this.camera.position)
    if (this.size.width !== width || this.size.height !== height) {
      this.size = { width, height }
      this.renderer.setSize(width, height, false)
    }
    this.renderer.toneMappingExposure = w.lighting.exposure
    this.renderer.render(w.scene, this.camera)
    return this.canvas
  }

  dispose(): void {
    for (const w of this.worlds.values()) w.dispose()
    this.worlds.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}
