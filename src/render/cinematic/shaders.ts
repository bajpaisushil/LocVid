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
// Clean plate (the picture with its cut-out subjects painted out) and where it applies.
uniform sampler2D uPlate;
uniform sampler2D uPlateMask;
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

// The background picture: the original, except where a cut-out subject was (there: the clean plate).
vec3 picture(vec2 uv) {
  vec3 c = texture(uImage, uv).rgb;
  float m = texture(uPlateMask, uv).r;
  return m > 0.0 ? mix(c, texture(uPlate, uv).rgb, m) : c;
}

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
  vec3 color = picture(uv);

  // Stretch detector: a steep depth gradient at the sampled point means the
  // ray hit the slope between two depth layers.
  float gx = texture(uDepth, uv + vec2(uDepthTexel.x, 0.0)).r - texture(uDepth, uv - vec2(uDepthTexel.x, 0.0)).r;
  float gy = texture(uDepth, uv + vec2(0.0, uDepthTexel.y)).r - texture(uDepth, uv - vec2(0.0, uDepthTexel.y)).r;
  float stretch = smoothstep(0.035, 0.1, length(vec2(gx, gy)));
  if (stretch > 0.001) {
    vec2 uvB = toImage(march(uBgDepth, s));
    vec3 behind = mix(picture(uvB), texture(uFill, uvB).rgb, texture(uHole, uvB).r);
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
      color = mix(color, picture(uvS), clamp(m * valid, 0.0, 1.0));
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
      color = mix(color, picture(uv + off), green);
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

/**
 * A cut-out subject ("actor") as a deformable grid mesh over its bounding box.
 * position.xy is the vertex's uv in the picture. The vertex shader applies
 * the actor's pose about its ground anchor (see subject.ts), then the same
 * virtual camera as the background at the actor's own depth.
 */
export const SUBJECT_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
uniform vec2 uCropOrigin;
uniform vec2 uCropSize;
uniform float uAspect;
uniform vec2 uAnchor;
uniform float uHeight;
uniform vec2 uMove;
uniform float uRotation;
uniform vec2 uScale;
uniform float uBend;
uniform vec2 uShift;
uniform float uDolly;
uniform float uBase;
uniform float uPivot;
uniform float uLevel;
float magnify(float d) { return uBase * (1.0 + uDolly * d) / (1.0 + uDolly * uPivot); }
void main() {
  vUv = position.xy;
  vec2 o = (position.xy - uCropOrigin) / uCropSize;
  // Actor-relative, isotropic units (actor heights), y down.
  vec2 q = vec2((o.x - uAnchor.x) * uAspect, o.y - uAnchor.y) / uHeight;
  float h = max(0.0, -q.y);
  q.x += uBend * h * h;
  q *= uScale;
  float c = cos(uRotation);
  float s = sin(uRotation);
  q = vec2(q.x * c - q.y * s, q.x * s + q.y * c) + uMove;
  vec2 p = uAnchor + vec2(q.x / uAspect, q.y) * uHeight;
  vec2 screen = 0.5 + (p - 0.5) * magnify(uLevel) + uShift * (uLevel - uPivot);
  gl_Position = vec4(screen.x * 2.0 - 1.0, 1.0 - screen.y * 2.0, 0.0, 1.0);
}
`

/** Pass 0: the actor's color over the scene (alpha = matte). Pass 1: its depth into the alpha channel. */
export const SUBJECT_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uImage;
uniform sampler2D uMatte;
uniform sampler2D uLabels;
uniform float uLabel;
uniform float uLevel;
uniform float uHaze;
uniform vec3 uHazeColor;
uniform int uPass;
void main() {
  float mine = abs(texture(uLabels, vUv).r * 255.0 - uLabel) < 0.5 ? 1.0 : 0.0;
  float a = texture(uMatte, vUv).r * mine;
  if (uPass == 1) {
    if (a < 0.5) discard;
    fragColor = vec4(0.0, 0.0, 0.0, uLevel);
    return;
  }
  if (a < 0.004) discard;
  vec3 color = texture(uImage, vUv).rgb;
  if (uHaze > 0.0) color = mix(color, uHazeColor, clamp(uHaze * pow(1.0 - uLevel, 2.0) * 0.9, 0.0, 0.92));
  fragColor = vec4(color, a);
}
`

/** Soft contact shadow on the ground under an actor (darkens color, keeps depth). */
export const SHADOW_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vLocal;
uniform vec2 uCenter;
uniform vec2 uRadius;
void main() {
  vLocal = position.xy;
  vec2 screen = uCenter + position.xy * uRadius;
  gl_Position = vec4(screen.x * 2.0 - 1.0, 1.0 - screen.y * 2.0, 0.0, 1.0);
}
`

export const SHADOW_FRAG = /* glsl */ `
precision highp float;
in vec2 vLocal;
out vec4 fragColor;
uniform float uStrength;
void main() {
  float r = length(vLocal);
  if (r >= 1.0) discard;
  float a = pow(1.0 - smoothstep(0.0, 1.0, r), 1.6) * uStrength;
  fragColor = vec4(0.0, 0.0, 0.0, a);
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

/** A quad around a prop: position.xy ∈ [-1, 1]², placed at uCenter with uRadius (frame units). */
export const PROP_QUAD_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vLocal;
uniform vec2 uCenter;
uniform vec2 uRadius;
void main() {
  vLocal = position.xy;
  vec2 screen = uCenter + position.xy * uRadius;
  gl_Position = vec4(screen.x * 2.0 - 1.0, 1.0 - screen.y * 2.0, 0.0, 1.0);
}
`

/**
 * Football as a sphere impostor. The panels are the spherical Voronoi cells of
 * a truncated icosahedron's 32 face centers (12 pentagons + 20 hexagons), so
 * the pattern has true pentagons, hexagons and seams; lit from the upper left
 * and hidden behind nearer scenery using the scene depth.
 */
export const BALL_FRAG = /* glsl */ `
precision highp float;
in vec2 vLocal;
out vec4 fragColor;
uniform float uSpin;
uniform float uDepth;
uniform float uAlpha;
uniform float uEdge;
uniform vec3 uAmbient;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;

const float PHI = 1.61803398875;

void faces(vec3 n, out float best, out float second, out float pent) {
  best = -2.0;
  second = -2.0;
  pent = 0.0;
  // 12 pentagon centers: the icosahedron's vertices.
  vec3 ico[12] = vec3[12](
    vec3(0.0, 1.0, PHI), vec3(0.0, -1.0, PHI), vec3(0.0, 1.0, -PHI), vec3(0.0, -1.0, -PHI),
    vec3(1.0, PHI, 0.0), vec3(-1.0, PHI, 0.0), vec3(1.0, -PHI, 0.0), vec3(-1.0, -PHI, 0.0),
    vec3(PHI, 0.0, 1.0), vec3(-PHI, 0.0, 1.0), vec3(PHI, 0.0, -1.0), vec3(-PHI, 0.0, -1.0));
  for (int i = 0; i < 12; i++) {
    float d = dot(n, normalize(ico[i]));
    if (d > best) { second = best; best = d; pent = 1.0; } else if (d > second) second = d;
  }
  // 20 hexagon centers: the dodecahedron's vertices (the icosahedron's face centers).
  float a = 1.0 / PHI;
  vec3 dod[20] = vec3[20](
    vec3(1.0, 1.0, 1.0), vec3(1.0, 1.0, -1.0), vec3(1.0, -1.0, 1.0), vec3(1.0, -1.0, -1.0),
    vec3(-1.0, 1.0, 1.0), vec3(-1.0, 1.0, -1.0), vec3(-1.0, -1.0, 1.0), vec3(-1.0, -1.0, -1.0),
    vec3(0.0, a, PHI), vec3(0.0, a, -PHI), vec3(0.0, -a, PHI), vec3(0.0, -a, -PHI),
    vec3(a, PHI, 0.0), vec3(a, -PHI, 0.0), vec3(-a, PHI, 0.0), vec3(-a, -PHI, 0.0),
    vec3(PHI, 0.0, a), vec3(PHI, 0.0, -a), vec3(-PHI, 0.0, a), vec3(-PHI, 0.0, -a));
  for (int i = 0; i < 20; i++) {
    float d = dot(n, normalize(dod[i]));
    if (d > best) { second = best; best = d; pent = 0.0; } else if (d > second) second = d;
  }
}

void main() {
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;
  float scene = texture(uSceneDepth, gl_FragCoord.xy / uResolution).a;
  if (scene > uDepth + 0.03) discard;
  // View-space normal (y up, toward the viewer).
  vec3 n = vec3(vLocal.x, -vLocal.y, sqrt(1.0 - r2));
  // Spin about the view axis (clockwise on screen), with a fixed tilt so the pattern isn't axis-aligned.
  float c = cos(uSpin);
  float s = sin(uSpin);
  vec3 m = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z);
  m = vec3(m.x, m.y * 0.866 - m.z * 0.5, m.y * 0.5 + m.z * 0.866);
  float best;
  float second;
  float pent;
  faces(m, best, second, pent);
  vec3 albedo = mix(vec3(0.93), vec3(0.06), pent);
  albedo = mix(vec3(0.35), albedo, smoothstep(0.004, 0.012, best - second));
  vec3 L = normalize(vec3(-0.45, 0.65, 0.62));
  float diffuse = max(0.0, dot(n, L));
  float spec = pow(max(0.0, dot(reflect(-L, n), vec3(0.0, 0.0, 1.0))), 24.0) * 0.35;
  vec3 color = albedo * (uAmbient * 0.38 + vec3(0.78) * diffuse) + spec;
  float edge = 1.0 - smoothstep(1.0 - uEdge, 1.0, sqrt(r2));
  fragColor = vec4(color, edge * uAlpha);
}
`

/**
 * Instanced sprite props, animated entirely on the GPU from per-instance
 * seeds and time, projected through the scene's camera at each instance's
 * depth: birds, balloons, butterflies, confetti, petals, leaves, lanterns.
 */
export const SPRITE_VERT = /* glsl */ `
precision highp float;
precision highp int;
in vec3 position;
in vec4 aSeed;
in vec4 aMotion;
out vec2 vLocal;
out float vDepth;
out vec3 vColor;
out float vParam;
out float vAlpha;
uniform float uTime;
uniform int uKind;
uniform vec2 uShift;
uniform float uDolly;
uniform float uBase;
uniform float uPivot;
uniform float uAspect;

float magnify(float d) { return uBase * (1.0 + uDolly * d) / (1.0 + uDolly * uPivot); }

vec3 palette(float r) {
  if (r < 0.14) return vec3(0.93, 0.2, 0.26);
  if (r < 0.28) return vec3(1.0, 0.78, 0.15);
  if (r < 0.42) return vec3(0.18, 0.55, 0.95);
  if (r < 0.56) return vec3(0.25, 0.8, 0.42);
  if (r < 0.70) return vec3(0.98, 0.45, 0.7);
  if (r < 0.84) return vec3(1.0, 0.55, 0.15);
  return vec3(0.6, 0.38, 0.9);
}

void main() {
  float t = uTime;
  vec2 base = aSeed.xy;
  float r = aSeed.z;
  float r2 = aSeed.w;
  float speed = aMotion.x;
  float phase = aMotion.y;
  vec2 center;
  vec2 size;
  float angle = 0.0;
  float depth;
  vec3 color = vec3(1.0);
  float param = 0.0;
  float alpha = 1.0;
  if (uKind == 1) { // birds: a loose V crossing the sky
    float row = floor(r2 * 4.0);
    float across = fract((t + base.x * 9.0) / 11.0);
    center = vec2(across * 1.4 - 0.2 - row * 0.03, 0.1 + base.y * 0.2 + row * 0.025 + sin(t * 0.9 + phase) * 0.008);
    size = vec2(0.026 + 0.016 * r) * vec2(1.0, 0.6);
    depth = 0.04 + 0.12 * r;
    float flap = sin(t * (8.0 + 4.0 * speed) + phase);
    float glide = smoothstep(0.55, 0.75, sin(t * 0.7 + phase * 3.0));
    param = mix(flap, 0.25, glide);
    color = vec3(0.1, 0.1, 0.12);
    alpha = 0.92;
  } else if (uKind == 2) { // balloons rising with a gentle sway
    float rise = fract(base.y + t * (0.035 + 0.025 * speed));
    center = vec2(base.x * 0.9 + 0.05 + sin(t * 0.8 + phase) * 0.025, 1.2 - rise * 1.5);
    size = vec2(0.045 + 0.03 * r) * vec2(0.85, 2.2);
    depth = 0.3 + 0.55 * r;
    angle = sin(t * 0.9 + phase) * 0.12;
    color = palette(r2);
  } else if (uKind == 3) { // butterflies wandering near the middle of the frame
    center = vec2(0.15 + base.x * 0.7 + 0.09 * sin(t * 0.55 + phase) + 0.035 * sin(t * 1.9 + phase * 2.0),
                  0.3 + base.y * 0.45 + 0.06 * sin(t * 0.8 + phase * 1.3) + 0.02 * sin(t * 3.1));
    size = vec2(0.022 + 0.012 * r);
    depth = 0.45 + 0.45 * r;
    param = abs(cos(t * (11.0 + 5.0 * speed) + phase));
    angle = 0.35 * sin(t * 0.6 + phase);
    color = r2 < 0.33 ? vec3(1.0, 0.55, 0.1) : r2 < 0.66 ? vec3(0.25, 0.6, 1.0) : vec3(1.0, 0.92, 0.35);
  } else if (uKind == 4) { // confetti tumbling down
    float fall = fract(base.y + t * (0.12 + 0.12 * speed));
    center = vec2(base.x + 0.03 * sin(t * 2.2 + phase), fall * 1.3 - 0.15);
    size = vec2(0.006 + 0.005 * r, 0.011 + 0.008 * r);
    depth = 0.15 + 0.85 * r;
    angle = t * (2.0 + 5.0 * speed) + phase;
    param = cos(t * (4.0 + 6.0 * speed) + phase * 2.0);
    color = palette(r2);
  } else if (uKind == 5 || uKind == 6) { // petals / leaves drifting down and across
    bool leaf = uKind == 6;
    float v = leaf ? 0.045 : 0.06;
    center = vec2(fract(base.x + t * (leaf ? 0.018 : 0.035) * (1.0 + speed)) * 1.25 - 0.12 + 0.03 * sin(t * 1.3 + phase),
                  fract(base.y + t * v * (0.7 + speed)) * 1.25 - 0.12);
    size = leaf ? vec2(0.016 + 0.012 * r, 0.022 + 0.014 * r) : vec2(0.009 + 0.006 * r, 0.013 + 0.007 * r);
    depth = 0.15 + 0.85 * r;
    angle = t * (0.8 + 1.6 * speed) + phase;
    param = cos(t * (1.6 + 2.4 * speed) + phase);
    color = leaf ? mix(vec3(0.85, 0.35, 0.08), vec3(0.95, 0.72, 0.15), r2) : mix(vec3(1.0, 0.72, 0.82), vec3(1.0, 0.92, 0.95), r2);
  } else { // lanterns rising, glowing
    float rise = fract(base.y + t * (0.02 + 0.018 * speed));
    center = vec2(base.x * 0.95 + 0.025 + sin(t * 0.5 + phase) * 0.02, 1.15 - rise * 1.4);
    size = vec2(0.016 + 0.02 * r) * vec2(0.8, 1.0);
    depth = 0.05 + 0.6 * r;
    param = 0.75 + 0.25 * sin(t * (5.0 + 4.0 * speed) + phase);
    color = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.75, 0.35), r2);
  }
  vLocal = position.xy;
  vDepth = depth;
  vColor = color;
  vParam = param;
  vAlpha = alpha;
  // Rotate the quad in isotropic units, then size it by the camera's magnification at this depth.
  float m = magnify(depth);
  vec2 q = position.xy * size;
  float c = cos(angle);
  float s = sin(angle);
  q = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  vec2 world = center + vec2(q.x / uAspect, q.y);
  vec2 screen = 0.5 + (world - 0.5) * m + uShift * (depth - uPivot);
  gl_Position = vec4(screen.x * 2.0 - 1.0, 1.0 - screen.y * 2.0, 0.0, 1.0);
}
`

export const SPRITE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vLocal;
in float vDepth;
in vec3 vColor;
in float vParam;
in float vAlpha;
out vec4 fragColor;
uniform int uKind;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  float scene = texture(uSceneDepth, gl_FragCoord.xy / uResolution).a;
  if (scene > vDepth + 0.03) discard;
  vec2 p = vLocal;
  float a = 0.0;
  vec3 color = vColor;
  if (uKind == 1) { // bird: two bent wings whose tips follow the flap
    vec2 q = vec2(abs(p.x), p.y);
    vec2 joint = vec2(0.42, -0.1 - 0.35 * vParam);
    vec2 tip = vec2(0.98, 0.15 - 0.85 * vParam);
    float d = min(segment(q, vec2(0.0, 0.05), joint), segment(q, joint, tip));
    float w = mix(0.16, 0.05, clamp(q.x, 0.0, 1.0));
    a = 1.0 - smoothstep(w - 0.04, w + 0.04, d);
    a = max(a, 1.0 - smoothstep(0.1, 0.18, length(vec2(p.x * 1.3, p.y - 0.05))));
  } else if (uKind == 2) { // balloon (upper part of the quad) on a string
    vec2 b = vec2(p.x, (p.y + 0.55) * 2.2);
    float body = length(vec2(b.x, b.y * 0.86));
    a = 1.0 - smoothstep(0.92, 1.0, body);
    float shade = clamp(0.55 + 0.45 * (-b.x * 0.5 - b.y * 0.6), 0.25, 1.0);
    float spec = smoothstep(0.32, 0.0, length(b - vec2(-0.35, -0.42)));
    color = color * shade + spec * 0.55;
    float knot = 1.0 - smoothstep(0.06, 0.12, length(vec2(p.x, p.y + 0.08)));
    float string = (1.0 - smoothstep(0.012, 0.03, abs(p.x - 0.04 * sin(p.y * 9.0)))) * step(-0.1, p.y);
    if (a < 0.5 && (knot > 0.0 || string > 0.0)) { a = max(knot, string * 0.75); color = mix(vec3(0.85), vColor * 0.8, knot); }
  } else if (uKind == 3) { // butterfly: two pairs of wings opening and closing
    vec2 q = vec2(abs(p.x) / max(0.15, vParam), p.y);
    float upper = length((q - vec2(0.45, -0.25)) * vec2(1.0, 1.15));
    float lower = length((q - vec2(0.35, 0.35)) * vec2(1.3, 1.4));
    float wing = min(upper / 0.5, lower / 0.36);
    a = 1.0 - smoothstep(0.85, 1.0, wing);
    color = mix(color, vec3(0.08), smoothstep(0.6, 0.95, wing) * 0.7);
    float body = 1.0 - smoothstep(0.05, 0.1, abs(p.x)) * 1.0;
    if (abs(p.y) < 0.55 && body > 0.0) { a = max(a, body); color = mix(color, vec3(0.1), body); }
  } else if (uKind == 4) { // confetti: a tumbling paper rectangle (foreshortened as it flips)
    float w = max(0.12, abs(vParam));
    a = (1.0 - smoothstep(w - 0.1, w, abs(p.x))) * (1.0 - smoothstep(0.85, 1.0, abs(p.y)));
    color *= 0.75 + 0.25 * abs(vParam);
  } else if (uKind == 5 || uKind == 6) { // petal / leaf, flipping
    float w = max(0.2, abs(vParam));
    vec2 q = vec2(p.x / w, p.y);
    float shape = uKind == 6 ? length(vec2(q.x * (1.0 + 0.6 * abs(q.y)), q.y)) : length(vec2(q.x * 1.1, q.y * (0.9 + 0.25 * q.y)));
    a = 1.0 - smoothstep(0.85, 1.0, shape);
    if (uKind == 6) color *= 0.82 + 0.18 * (1.0 - smoothstep(0.0, 0.08, abs(q.x)));
    color *= 0.8 + 0.2 * abs(vParam);
  } else { // lantern: a warm glowing paper box with a soft halo
    vec2 q = vec2(p.x * (1.0 + 0.25 * p.y), p.y);
    float box = max(abs(q.x), abs(q.y));
    float body = 1.0 - smoothstep(0.62, 0.72, box);
    float glow = exp(-dot(p, p) * 2.2) * 0.45 * vParam;
    a = max(body * (0.75 + 0.25 * vParam), glow);
    color = color * (0.7 + 0.6 * vParam * (1.0 - smoothstep(0.0, 0.7, length(p - vec2(0.0, 0.25)))));
  }
  if (a < 0.01) discard;
  fragColor = vec4(color, a * vAlpha);
}
`

/** Writes a disc's depth into the alpha channel (color untouched) so depth of field treats the prop right. */
export const DISC_DEPTH_FRAG = /* glsl */ `
precision highp float;
in vec2 vLocal;
out vec4 fragColor;
uniform float uDepth;
void main() {
  if (dot(vLocal, vLocal) > 0.81) discard;
  fragColor = vec4(0.0, 0.0, 0.0, uDepth);
}
`
