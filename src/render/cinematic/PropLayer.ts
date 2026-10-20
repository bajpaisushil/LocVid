import {
  BufferAttribute,
  CustomBlending,
  DoubleSide,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RawShaderMaterial,
  SrcAlphaFactor,
  ZeroFactor,
  type OrthographicCamera,
  type Scene,
  type Texture,
  Vector2,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
  BufferGeometry,
} from 'three'
import type { PropKind } from '@/core/types'
import { createRng } from '@/lib/math'
import type { CameraState } from './camera'
import { SPRITE_COUNT, SPRITE_KIND, SPRITE_PROPS, type BallState, type SpriteProp } from './props'
import { BALL_FRAG, DISC_DEPTH_FRAG, PROP_QUAD_VERT, SHADOW_FRAG, SPRITE_FRAG, SPRITE_VERT } from './shaders'

/** Blend color over the scene but keep the destination alpha (it carries depth). */
const OVER_KEEP_DEPTH = { blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor } as const

export interface BallDraw {
  state: BallState
  /** Disparity of the ground the ball is on. */
  level: number
  /** Main actor height in frame-uv y units (the ball's scale reference). */
  actorHeight: number
}

export interface PropDraw {
  target: WebGLRenderTarget
  /** The scene before props (its alpha holds depth), for occlusion. */
  sceneDepth: Texture
  width: number
  height: number
  time: number
  camera: CameraState
  props: readonly PropKind[]
  ambient: Vector3
  ball: BallDraw | null
}

const placed = () => ({ uCenter: { value: new Vector2() }, uRadius: { value: new Vector2(0.05, 0.05) } })

const mat = (fragmentShader: string, uniforms: Record<string, { value: unknown }>, blend: object) =>
  new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: PROP_QUAD_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, transparent: true, side: DoubleSide, ...blend })

function quad(): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}

/** Draws 3D props into a cinematic shot: the football (shadow, color, depth) and GPU-instanced sprites. */
export class PropLayer {
  private readonly renderer: WebGLRenderer
  private readonly scene: Scene
  private readonly camera: OrthographicCamera
  private readonly disc = quad()
  private readonly ball: Mesh
  private readonly ballDepth: Mesh
  private readonly ballShadow: Mesh
  private readonly sprites = new Map<SpriteProp, Mesh>()

  constructor(renderer: WebGLRenderer, scene: Scene, camera: OrthographicCamera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.ball = new Mesh(
      this.disc,
      mat(
        BALL_FRAG,
        { ...placed(), uSpin: { value: 0 }, uDepth: { value: 0.5 }, uAlpha: { value: 1 }, uEdge: { value: 0.05 }, uAmbient: { value: new Vector3(0.8, 0.8, 0.8) }, uSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) } },
        OVER_KEEP_DEPTH,
      ),
    )
    this.ballDepth = new Mesh(
      this.disc,
      mat(DISC_DEPTH_FRAG, { ...placed(), uDepth: { value: 0.5 } }, { blending: CustomBlending, blendSrc: ZeroFactor, blendDst: OneFactor, blendSrcAlpha: OneFactor, blendDstAlpha: ZeroFactor }),
    )
    this.ballShadow = new Mesh(this.disc, mat(SHADOW_FRAG, { ...placed(), uStrength: { value: 0 } }, { ...OVER_KEEP_DEPTH, blendSrc: ZeroFactor }))
    for (const m of [this.ball, this.ballDepth, this.ballShadow]) m.frustumCulled = false
  }

  private sprite(kind: SpriteProp): Mesh {
    let mesh = this.sprites.get(kind)
    if (mesh) return mesh
    const count = SPRITE_COUNT[kind]
    const rng = createRng(0x9e37 + SPRITE_KIND[kind] * 7919)
    const seed = new Float32Array(count * 4)
    const motion = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      seed.set([rng(), rng(), rng(), rng()], i * 4)
      motion.set([rng(), rng() * Math.PI * 2, rng(), rng()], i * 4)
    }
    const geometry = new InstancedBufferGeometry()
    geometry.setAttribute('position', this.disc.getAttribute('position'))
    geometry.setIndex(this.disc.getIndex())
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(seed, 4))
    geometry.setAttribute('aMotion', new InstancedBufferAttribute(motion, 4))
    geometry.instanceCount = count
    const glow = kind === 'lanterns'
    const material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uKind: { value: SPRITE_KIND[kind] },
        uShift: { value: new Vector2() },
        uDolly: { value: 0 },
        uBase: { value: 1 },
        uPivot: { value: 0.5 },
        uAspect: { value: 1 },
        uSceneDepth: { value: null },
        uResolution: { value: new Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: DoubleSide,
      ...(glow ? { blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor } : OVER_KEEP_DEPTH),
    })
    mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false
    this.sprites.set(kind, mesh)
    return mesh
  }

  private render(mesh: Mesh) {
    this.scene.add(mesh)
    this.renderer.render(this.scene, this.camera)
    this.scene.remove(mesh)
  }

  /** Draw the props into `target` (whose content already holds the scene). The caller hides other scene objects. */
  draw(input: PropDraw): void {
    const { camera, width, height } = input
    const aspect = width / height
    this.renderer.setRenderTarget(input.target)
    const magnify = (d: number) => (camera.base * (1 + camera.dolly * d)) / (1 + camera.dolly * camera.pivot)
    const project = (x: number, y: number, d: number) =>
      new Vector2(0.5 + (x - 0.5) * magnify(d) + camera.shiftX * (d - camera.pivot), 0.5 + (y - 0.5) * magnify(d) + camera.shiftY * (d - camera.pivot))

    const before = SPRITE_PROPS.filter((k) => k !== 'confetti' && input.props.includes(k))
    const spriteUniforms = (mesh: Mesh) => {
      const u = (mesh.material as RawShaderMaterial).uniforms
      u.uTime!.value = input.time
      ;(u.uShift!.value as Vector2).set(camera.shiftX, camera.shiftY)
      u.uDolly!.value = camera.dolly
      u.uBase!.value = camera.base
      u.uPivot!.value = camera.pivot
      u.uAspect!.value = aspect
      u.uSceneDepth!.value = input.sceneDepth
      ;(u.uResolution!.value as Vector2).set(width, height)
    }
    for (const kind of before) {
      const mesh = this.sprite(kind)
      spriteUniforms(mesh)
      this.render(mesh)
    }

    const b = input.ball
    if (b && b.state.alpha > 0.001) {
      const { state } = b
      const level = Math.min(1, b.level + state.depth)
      const m = magnify(level)
      const ry = state.radius * b.actorHeight * m
      const rx = ry / aspect
      // Contact shadow on the ground under the ball, fading as it rises.
      const ground = project(state.x, state.y, level)
      const su = (this.ballShadow.material as RawShaderMaterial).uniforms
      ;(su.uCenter!.value as Vector2).copy(ground)
      ;(su.uRadius!.value as Vector2).set(rx * 1.25 * (1 + state.lift * 0.6), ry * 0.32 * (1 + state.lift * 0.6))
      su.uStrength!.value = 0.45 * Math.max(0, 1 - state.lift * 1.4) * state.alpha
      if (su.uStrength!.value > 0.01) this.render(this.ballShadow)
      // The ball itself, lifted above the ground.
      const center = project(state.x, state.y - (state.lift + state.radius) * b.actorHeight, level)
      const bu = (this.ball.material as RawShaderMaterial).uniforms
      ;(bu.uCenter!.value as Vector2).copy(center)
      ;(bu.uRadius!.value as Vector2).set(rx, ry)
      bu.uSpin!.value = state.spin
      bu.uDepth!.value = level
      bu.uAlpha!.value = state.alpha
      bu.uEdge!.value = Math.min(0.5, 1.5 / Math.max(1, ry * height))
      ;(bu.uAmbient!.value as Vector3).copy(input.ambient)
      bu.uSceneDepth!.value = input.sceneDepth
      ;(bu.uResolution!.value as Vector2).set(width, height)
      this.render(this.ball)
      const du = (this.ballDepth.material as RawShaderMaterial).uniforms
      ;(du.uCenter!.value as Vector2).copy(center)
      ;(du.uRadius!.value as Vector2).set(rx, ry)
      du.uDepth!.value = level
      this.render(this.ballDepth)
    }

    if (input.props.includes('confetti')) {
      const mesh = this.sprite('confetti')
      spriteUniforms(mesh)
      this.render(mesh)
    }
  }

  dispose(): void {
    this.disc.dispose()
    for (const m of [this.ball, this.ballDepth, this.ballShadow]) (m.material as RawShaderMaterial).dispose()
    for (const m of this.sprites.values()) {
      m.geometry.dispose()
      ;(m.material as RawShaderMaterial).dispose()
    }
  }
}
