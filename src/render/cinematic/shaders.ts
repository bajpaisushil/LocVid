/**
 * GLSL (WebGL2 / GLSL ES 3.00) for the cinematic renderer. Everything is a
 * pure function of uniforms — notably time — so a frame rendered in the live
 * preview and the same frame rendered during export are identical.
 *
 * Coordinates: shaders work in "screen" space with y pointing down (like a
 * 2D canvas), so the camera math matches `camera.ts` exactly. Textures are
 * uploaded without flipping (row 0 = top), so image uv = screen-space uv.
 */

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
`

/**
 * Fullscreen triangle. vScreen: y-down screen uv (for sampling uploaded,
 * unflipped pictures and for camera math). vUv: GL's y-up uv — use it to
 * sample render targets, which GL stores bottom row first.
 */
export const FULLSCREEN_VERT = /* glsl */ `
in vec3 position;
out vec2 vScreen;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  vScreen = vec2(vUv.x, 1.0 - vUv.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * Depth parallax with two layers. Each output pixel is inverse-mapped through
 * the virtual camera by ray-marching the depth map (near → far, so nearer
 * surfaces occlude). Where that lands on a steep depth edge — the "rubber
 * sheet" a single depth layer stretches when the camera moves — it marches
 * the background layer instead: depth and color with the occluders removed
 * and filled in, so revealed areas show plausible scenery, not smears.
 */
export const PARALLAX_FRAG = /* glsl */ `
${COMMON}
in vec2 vScreen;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform sampler2D uBgDepth;
uniform sampler2D uFill;
uniform sampler2D uHole;
uniform sampler2D uFar;
uniform vec2 uDepthTexel;
uniform vec2 uCropOrigin;
uniform vec2 uCropSize;
uniform vec2 uShift;
uniform float uDolly;
uniform float uBase;
uniform float uPivot;
uniform float uTime;
uniform float uSky;
uniform float uFoliage;
uniform float uHaze;
uniform vec3 uHazeColor;
uniform int uSteps;

vec2 toImage(vec2 s) { return uCropOrigin + s * uCropSize; }
float magnify(float d) { return uBase * (1.0 + uDolly * d) / (1.0 + uDolly * uPivot); }
vec2 sourceAt(vec2 s, float level) { return 0.5 + (s - 0.5 - uShift * (level - uPivot)) / magnify(level); }

vec2 march(sampler2D depthMap, vec2 s) {
  float steps = float(uSteps);
  float prevLevel = 1.0;
  float prevDiff = -1.0;
  for (int i = 0; i <= 96; i++) {
    if (i > uSteps) break;
    float level = 1.0 - float(i) / steps;
    vec2 o = sourceAt(s, level);
    float diff = texture(depthMap, toImage(o)).r - level;
    if (diff >= 0.0) {
      float t = prevDiff / (prevDiff - diff);
      return sourceAt(s, mix(prevLevel, level, clamp(t, 0.0, 1.0)));
    }
    prevLevel = level;
    prevDiff = diff;
  }
  return sourceAt(s, 0.0);
}

void main() {
  vec2 s = vScreen;
  vec2 uv = toImage(march(uDepth, s));
  float d = texture(uDepth, uv).r;
  vec3 color = texture(uImage, uv).rgb;

  // Stretch detector: a steep depth gradient at the sampled point means the
  // ray hit the slope between two depth layers.
  float gx = texture(uDepth, uv + vec2(uDepthTexel.x, 0.0)).r - texture(uDepth, uv - vec2(uDepthTexel.x, 0.0)).r;
  float gy = texture(uDepth, uv + vec2(0.0, uDepthTexel.y)).r - texture(uDepth, uv - vec2(0.0, uDepthTexel.y)).r;
  float stretch = smoothstep(0.035, 0.1, length(vec2(gx, gy)));
  if (stretch > 0.001) {
    vec2 uvB = toImage(march(uBgDepth, s));
    vec3 behind = mix(texture(uImage, uvB).rgb, texture(uFill, uvB).rgb, texture(uHole, uvB).r);
    color = mix(color, behind, stretch);
    d = mix(d, texture(uBgDepth, uvB).r, stretch);
    uv = mix(uv, uvB, stretch);
  }

  // Far region (sky / haze): a slow monotonic drift — no crossfade, so no ghosting.
  if (uSky > 0.0) {
    float m = texture(uFar, uv).r;
    if (m > 0.004) {
      vec2 wobble = vec2(noise2(uv * 2.0 + uTime * 0.03), noise2(uv * 2.0 + 5.1 - uTime * 0.03)) - 0.5;
      vec2 uvS = uv - (vec2(0.0045, 0.0006) * uTime + wobble * 0.002) * uSky;
      float valid = texture(uFar, uvS).r;
      color = mix(color, texture(uImage, uvS).rgb, clamp(m * valid, 0.0, 1.0));
    }
  }

  // Vegetation: a gentle, gusty sway masked by green hues.
  if (uFoliage > 0.0) {
    vec3 hsv = rgb2hsv(color);
    float green = smoothstep(0.16, 0.21, hsv.x) * (1.0 - smoothstep(0.43, 0.5, hsv.x)) * smoothstep(0.18, 0.35, hsv.y) * smoothstep(0.08, 0.2, hsv.z);
    if (green > 0.01) {
      float gust = 0.6 + 0.4 * sin(uTime * 0.7 + uv.x * 3.0);
      float wave = sin(uTime * 1.9 + uv.y * 26.0 + noise2(uv * 7.0) * 6.2831) * gust;
      vec2 off = vec2(wave * 0.0016, wave * 0.0005) * uFoliage * (0.35 + 0.65 * d);
      color = mix(color, texture(uImage, uv + off).rgb, green);
    }
  }

  // Atmospheric perspective: farther = hazier, with a slow breathing variation.
  if (uHaze > 0.0) {
    float amount = uHaze * pow(1.0 - d, 2.0) * (0.82 + 0.18 * noise2(uv * 2.0 + uTime * 0.06));
    color = mix(color, uHazeColor, clamp(amount, 0.0, 0.92));
  }
  fragColor = vec4(color, d);
}
`

/** Copies a flat 2D picture into the pipeline (non-depth scenes still get the film look). */
export const COPY_FRAG = /* glsl */ `
precision highp float;
in vec2 vScreen;
out vec4 fragColor;
uniform sampler2D uSource;
void main() { fragColor = vec4(texture(uSource, vScreen).rgb, 0.5); }
`

/** Depth of field: golden-angle gather blur sized by each pixel's distance from the focus plane. */
export const DOF_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uFocus;
uniform float uMaxRadius;
const int SAMPLES = 28;
float coc(float d) { return clamp(abs(d - uFocus) * 2.4, 0.0, 1.0) * uMaxRadius; }
void main() {
  vec4 center = texture(uSource, vUv);
  float c = coc(center.a);
  if (c < 0.6) { fragColor = center; return; }
  vec3 acc = center.rgb;
  float total = 1.0;
  for (int i = 0; i < SAMPLES; i++) {
    float r = sqrt((float(i) + 0.5) / float(SAMPLES)) * c;
    float a = float(i) * 2.39996323;
    vec4 smp = texture(uSource, vUv + vec2(cos(a), sin(a)) * r * uTexel);
    // A neighbour only bleeds in if its own blur reaches this far (avoids sharp halos).
    float w = smoothstep(r - 1.5, r + 0.5, coc(smp.a));
    acc += smp.rgb * w;
    total += w;
  }
  fragColor = vec4(acc / total, center.a);
}
`

/** Bloom: keep only bright light. */
export const BRIGHT_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSource;
void main() {
  vec3 c = texture(uSource, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(c * smoothstep(0.62, 0.95, l), 1.0);
}
`

/** Separable 9-tap Gaussian. */
export const BLUR_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSource;
uniform vec2 uDirection;
void main() {
  vec3 acc = texture(uSource, vUv).rgb * 0.2270270270;
  acc += texture(uSource, vUv + uDirection * 1.3846153846).rgb * 0.3162162162;
  acc += texture(uSource, vUv - uDirection * 1.3846153846).rgb * 0.3162162162;
  acc += texture(uSource, vUv + uDirection * 3.2307692308).rgb * 0.0702702703;
  acc += texture(uSource, vUv - uDirection * 3.2307692308).rgb * 0.0702702703;
  fragColor = vec4(acc, 1.0);
}
`

/** Final grade: white balance, contrast, lift/gamma/gain, saturation, split toning, bloom, vignette, grain, letterbox. */
export const GRADE_FRAG = /* glsl */ `
${COMMON}
in vec2 vScreen;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSource;
uniform sampler2D uBloom;
uniform float uBloomAmount;
uniform float uTemperature;
uniform float uTint;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSaturation;
uniform vec3 uShadows;
uniform vec3 uHighlights;
uniform float uFade;
uniform float uVignette;
uniform float uGrain;
uniform float uLetterbox;
uniform float uAspect;
uniform float uFrame;
uniform float uSharpen;
uniform vec2 uTexel;
void main() {
  vec3 c = texture(uSource, vUv).rgb;
  // Unsharp mask: recovers some crispness lost when a small picture is enlarged.
  if (uSharpen > 0.0) {
    vec3 blur = (texture(uSource, vUv + vec2(uTexel.x, 0.0)).rgb + texture(uSource, vUv - vec2(uTexel.x, 0.0)).rgb +
                 texture(uSource, vUv + vec2(0.0, uTexel.y)).rgb + texture(uSource, vUv - vec2(0.0, uTexel.y)).rgb) * 0.25;
    c += (c - blur) * uSharpen;
  }
  c += texture(uBloom, vUv).rgb * uBloomAmount;
  c *= vec3(1.0 + uTemperature * 0.08, 1.0 + uTint * 0.04, 1.0 - uTemperature * 0.08);
  c = (c - 0.5) * uContrast + 0.5;
  c = max(c * uGain + uLift * (1.0 - c), 0.0);
  c = pow(c, 1.0 / uGamma);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c += uShadows * (1.0 - smoothstep(0.0, 0.55, l)) + uHighlights * smoothstep(0.45, 1.0, l);
  c = mix(c, vec3(0.5) + (c - 0.5) * 0.85, uFade);
  vec2 p = (vScreen - 0.5) * vec2(uAspect, 1.0);
  float v = smoothstep(0.95, 0.25, length(p) / max(1.0, uAspect * 0.62));
  c *= mix(1.0, v, uVignette);
  float n = hash12(gl_FragCoord.xy + vec2(uFrame * 17.0, uFrame * 31.0)) - 0.5;
  c += n * uGrain * 0.11 * (1.0 - abs(l - 0.5));
  if (vScreen.y < uLetterbox || vScreen.y > 1.0 - uLetterbox) c = vec3(0.0);
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`

/** Atmosphere particles, projected through the same camera and occluded by the scene's depth. */
export const PARTICLE_VERT = /* glsl */ `
precision highp float;
precision highp int;
in vec3 position;
in vec4 aSeed;
in vec4 aMotion;
out float vAlpha;
out float vDepth;
out vec2 vVelocity;
uniform float uTime;
uniform int uKind;
uniform vec2 uShift;
uniform float uDolly;
uniform float uBase;
uniform float uPivot;
uniform float uPixelScale;

float magnify(float d) { return uBase * (1.0 + uDolly * d) / (1.0 + uDolly * uPivot); }

void main() {
  vec2 base = aSeed.xy;
  float depth = aSeed.z;
  float r = aSeed.w;
  float speed = aMotion.x;
  float phase = aMotion.y;
  float t = uTime;
  vec2 pos;
  float size;
  float alpha = 1.0;
  vec2 vel = vec2(0.0, 1.0);
  if (uKind == 1) { // dust motes
    pos = base + vec2(sin(t * 0.21 * speed + phase), cos(t * 0.17 * speed + phase * 1.7)) * 0.025 + vec2(t * 0.004, -t * 0.002);
    size = mix(1.2, 3.6, r);
    alpha = 0.35 + 0.35 * sin(t * 0.8 + phase);
  } else if (uKind == 2) { // snow
    pos = vec2(base.x + sin(t * 1.1 * speed + phase) * 0.018 + t * 0.006, base.y + t * (0.035 + 0.05 * speed));
    size = mix(2.0, 6.5, r * depth + 0.2);
    alpha = 0.85;
  } else if (uKind == 3) { // rain
    pos = vec2(base.x + (base.y + t * (0.9 + 0.6 * speed)) * 0.12, base.y + t * (0.9 + 0.6 * speed));
    size = mix(14.0, 30.0, depth);
    alpha = 0.32;
    vel = normalize(vec2(0.12, 1.0));
  } else if (uKind == 4) { // fireflies
    pos = base + vec2(sin(t * 0.5 * speed + phase) + sin(t * 0.23 + phase * 2.0), cos(t * 0.37 * speed + phase)) * 0.03;
    size = mix(3.0, 7.0, r);
    alpha = pow(0.5 + 0.5 * sin(t * (1.2 + speed) + phase), 3.0);
  } else if (uKind == 5) { // embers
    pos = vec2(base.x + sin(t * 1.7 * speed + phase) * 0.015, base.y - t * (0.05 + 0.07 * speed));
    size = mix(2.0, 4.5, r);
    alpha = 0.55 + 0.45 * sin(t * 9.0 * speed + phase);
  } else { // sparkles
    pos = base;
    size = mix(4.0, 10.0, r);
    alpha = pow(max(0.0, sin(t * (1.0 + 2.0 * speed) + phase)), 8.0);
  }
  pos = fract(pos);
  // Same camera as the scene: particles live at their own depth in the 3D space.
  vec2 s = 0.5 + (pos - 0.5) * magnify(depth) + uShift * (depth - uPivot);
  vAlpha = alpha;
  vDepth = depth;
  vVelocity = vel;
  gl_PointSize = size * uPixelScale * mix(0.7, 1.3, depth);
  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0);
}
`

export const PARTICLE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in float vAlpha;
in float vDepth;
in vec2 vVelocity;
out vec4 fragColor;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform int uKind;
uniform float uOcclude;
void main() {
  float scene = texture(uSceneDepth, gl_FragCoord.xy / uResolution).a;
  if (uOcclude > 0.5 && scene > vDepth + 0.03) discard;
  vec2 p = gl_PointCoord - 0.5;
  float a;
  vec3 color;
  if (uKind == 3) {
    vec2 dir = vVelocity;
    float along = dot(p, dir);
    float across = abs(p.x * dir.y - p.y * dir.x);
    a = smoothstep(0.035, 0.0, across) * smoothstep(0.5, 0.0, abs(along));
    color = vec3(0.8, 0.85, 0.95);
  } else if (uKind == 6) {
    float cross = max(smoothstep(0.06, 0.0, abs(p.x)) * smoothstep(0.5, 0.0, abs(p.y)), smoothstep(0.06, 0.0, abs(p.y)) * smoothstep(0.5, 0.0, abs(p.x)));
    a = max(cross, smoothstep(0.18, 0.0, length(p)));
    color = vec3(1.0, 0.97, 0.88);
  } else {
    float r = length(p);
    a = smoothstep(0.5, 0.0, r);
    a *= a;
    color = uKind == 4 ? vec3(0.85, 1.0, 0.45) : uKind == 5 ? vec3(1.0, 0.55, 0.18) : vec3(1.0, 0.97, 0.92);
  }
  fragColor = vec4(color, a * vAlpha);
}
`
