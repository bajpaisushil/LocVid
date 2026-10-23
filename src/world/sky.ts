import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three'
import type { WorldTimeOfDay, WorldWeather } from '@/core/types'

/**
 * Sky and light for a time of day: a shader dome (gradient, sun disc and
 * glow, drifting clouds; stars and a moon at night) plus the sun/fill light
 * settings and fog that match it.
 */

export interface Lighting {
  /** Direction toward the sun (or moon), normalized. */
  sun: Vector3
  sunColor: Color
  sunIntensity: number
  hemiSky: Color
  hemiGround: Color
  hemiIntensity: number
  top: Color
  horizon: Color
  fog: Color
  fogNear: number
  fogFar: number
  clouds: number
  night: boolean
  exposure: number
}

/** Direction toward a light at an elevation and azimuth (degrees; azimuth 0 = toward −z). */
function dir(elevationDeg: number, azimuthDeg: number): Vector3 {
  const e = (elevationDeg * Math.PI) / 180
  const a = (azimuthDeg * Math.PI) / 180
  return new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize()
}

export function lightingFor(time: WorldTimeOfDay, weather: WorldWeather): Lighting {
  let l: Lighting
  switch (time) {
    case 'morning':
      l = {
        sun: dir(24, -35),
        sunColor: new Color('#ffd9a8'),
        sunIntensity: 2.4,
        hemiSky: new Color('#cfe2ff'),
        hemiGround: new Color('#8a7152'),
        hemiIntensity: 1.15,
        top: new Color('#4f8fdc'),
        horizon: new Color('#ffe0bf'),
        fog: new Color('#f3dcc2'),
        fogNear: 60,
        fogFar: 300,
        clouds: 0.38,
        night: false,
        exposure: 1.0,
      }
      break
    case 'sunset':
      l = {
        sun: dir(8, -30),
        sunColor: new Color('#ff9a55'),
        sunIntensity: 2.2,
        hemiSky: new Color('#ffbf94'),
        hemiGround: new Color('#6b4a3a'),
        hemiIntensity: 1.0,
        top: new Color('#33447f'),
        horizon: new Color('#ff9c66'),
        fog: new Color('#eaa27c'),
        fogNear: 50,
        fogFar: 260,
        clouds: 0.45,
        night: false,
        exposure: 1.05,
      }
      break
    case 'night':
      l = {
        sun: dir(38, 30),
        sunColor: new Color('#a9bcff'),
        sunIntensity: 0.75,
        hemiSky: new Color('#3a4f8a'),
        hemiGround: new Color('#1a1a26'),
        hemiIntensity: 0.75,
        top: new Color('#060a1c'),
        horizon: new Color('#1d2c50'),
        fog: new Color('#141d36'),
        fogNear: 40,
        fogFar: 220,
        clouds: 0.25,
        night: true,
        exposure: 1.2,
      }
      break
    default:
      l = {
        sun: dir(52, -40),
        sunColor: new Color('#fff3df'),
        sunIntensity: 2.7,
        hemiSky: new Color('#c2e0ff'),
        hemiGround: new Color('#8c7a58'),
        hemiIntensity: 1.1,
        top: new Color('#3d8be0'),
        horizon: new Color('#cbe7f6'),
        fog: new Color('#d3e8f3'),
        fogNear: 70,
        fogFar: 340,
        clouds: 0.42,
        night: false,
        exposure: 1.0,
      }
  }
  if (weather !== 'clear') {
    // Overcast: flatter light, grayer sky, closer fog, full cloud cover.
    const gray = new Color(weather === 'snow' ? '#dfe5ec' : '#8d97a3')
    l.top.lerp(gray, 0.75)
    l.horizon.lerp(gray, 0.6)
    l.fog.lerp(gray, 0.7)
    l.sunIntensity *= 0.45
    l.hemiIntensity *= 1.15
    l.fogNear *= 0.6
    l.fogFar *= 0.6
    l.clouds = 0.9
  }
  return l
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`

const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uClouds;
uniform float uNight;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
  float s = max(dot(d, uSunDir), 0.0);
  // Sun (or moon) glow and disc.
  col += uSunColor * (pow(s, 12.0) * 0.25 + pow(s, 300.0) * 0.9) * (1.0 - uNight * 0.6);
  col = mix(col, uSunColor * 1.6, smoothstep(0.9993, 0.9997, s) * (uNight > 0.5 ? 0.9 : 1.0));
  // Stars at night.
  if (uNight > 0.5) {
    vec2 sp = d.xz / (d.y + 0.15) * 90.0;
    float star = step(0.9975, hash(floor(sp))) * smoothstep(0.05, 0.3, h);
    col += vec3(star) * 0.9;
  }
  // Clouds: a drifting fbm layer projected on the dome, thinning toward the horizon.
  vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
  float c = fbm(cp);
  float cover = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.3, c) * smoothstep(0.02, 0.25, h);
  vec3 cloud = mix(uHorizon * 0.95 + 0.08, vec3(1.0), 0.55) * (uNight > 0.5 ? 0.25 : 1.0);
  cloud = mix(cloud * 0.82, cloud, smoothstep(0.3, 0.8, c));
  col = mix(col, cloud + uSunColor * pow(s, 8.0) * 0.2, cover * 0.85);
  gl_FragColor = vec4(col, 1.0);
}
`

export function createSky(l: Lighting): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTop: { value: l.top.clone() },
      uHorizon: { value: l.horizon.clone() },
      uSunDir: { value: l.sun.clone() },
      uSunColor: { value: l.sunColor.clone() },
      uTime: { value: 0 },
      uClouds: { value: l.clouds },
      uNight: { value: l.night ? 1 : 0 },
    },
    side: BackSide,
    depthWrite: false,
    fog: false,
  })
  const mesh = new Mesh(new SphereGeometry(500, 32, 16), material)
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  return mesh
}
