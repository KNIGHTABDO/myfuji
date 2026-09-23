export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uSrc;   // sRGB texture, hardware-decoded to linear
uniform sampler2D uAux;   // r: base log2 luma, g: mid-frequency log2 luma, b: halation energy, a: subject mask
uniform sampler3D uLut;
uniform sampler3D uLutSkin;
uniform float uLutSize;

uniform vec4 uView;        // image-uv rect rendered into this viewport (x0, y0, x1, y1)
uniform vec4 uCrop;        // image-uv rect of the crop (for vignette / leak geometry)
uniform vec2 uFull;        // full image size, px
uniform float uScale;      // source px per output px
uniform float uFlipY;

uniform vec3 uWb;
uniform float uEv;
uniform float uCompress;
uniform float uShadowLift;
uniform float uClarity;
uniform float uSubjectLift;
uniform vec2 uShoulder;    // knee, white point
uniform float uHalation;
uniform vec3 uHalTint;
uniform float uSharp;
uniform float uIntensity;
uniform float uSkin;
uniform float uGrain;
uniform float uGrainSize;  // full-res px
uniform float uGrainChroma;
uniform float uVignette;
uniform float uLeak;
uniform float uLeakSeed;
uniform float uSplit;      // output-x below which the original is shown (-1 = none)
uniform float uOriginal;   // 1 = show the untouched source

const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
const float MID = -2.4739; // log2(0.18)

vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 toLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Zero-mean, roughly unit-variance clumpy grain.
float grainAt(vec2 p) {
  float n = vnoise(p) + 0.55 * vnoise(p * 2.13 + 17.1) + 0.3 * vnoise(p * 4.7 + 5.3);
  return (n - 0.925) * 2.6;
}

vec3 lut(sampler3D s, vec3 c) {
  vec3 k = clamp(c, 0.0, 1.0) * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
  return texture(s, k).rgb;
}

float skinLikelihood(vec3 e) {
  float Y = dot(e, vec3(0.299, 0.587, 0.114));
  float cb = (e.b - Y) * 0.564 + 0.5;
  float cr = (e.r - Y) * 0.713 + 0.5;
  float a = smoothstep(0.52, 0.56, cr) * (1.0 - smoothstep(0.66, 0.70, cr));
  float b = smoothstep(0.34, 0.38, cb) * (1.0 - smoothstep(0.50, 0.53, cb));
  return a * b * smoothstep(0.08, 0.2, Y);
}

void main() {
  vec2 o = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlipY));
  vec2 uv = mix(uView.xy, uView.zw, o);
  vec3 src = texture(uSrc, uv).rgb;

  if (uOriginal > 0.5 || o.x < uSplit) {
    frag = vec4(toSrgb(src), 1.0);
    return;
  }

  // --- sharpening / softening on luminance ---
  vec3 lin = src;
  if (abs(uSharp) > 0.001) {
    vec2 t = max(1.0, uScale) / uFull;
    float yc = dot(src, LW);
    float yn = dot(texture(uSrc, uv + vec2(t.x, 0.0)).rgb, LW) + dot(texture(uSrc, uv - vec2(t.x, 0.0)).rgb, LW)
             + dot(texture(uSrc, uv + vec2(0.0, t.y)).rgb, LW) + dot(texture(uSrc, uv - vec2(0.0, t.y)).rgb, LW);
    float ys = max(yc + uSharp * (yc - yn * 0.25), 0.0);
    lin *= yc > 1e-5 ? ys / yc : 1.0;
  }

  // --- white balance & exposure with adaptive local tone mapping ---
  lin *= uWb;
  vec4 aux = texture(uAux, uv);
  float Y = max(dot(lin, LW), 1e-6);
  float logY = log2(Y) + uEv;
  float base = aux.r + uEv;
  // Compress bright bases (hold skies) far more than dark ones (keep blacks black).
  float nb = MID + (base - MID) * (1.0 - uCompress * (base > MID ? 1.0 : 0.3));
  nb += uShadowLift * (1.0 - smoothstep(MID - 4.5, MID + 0.3, base));
  float detail = logY - base;
  float mid = clamp(logY - (aux.g + uEv), -1.5, 1.5);
  float midMask = smoothstep(MID - 5.0, MID - 1.5, logY) * (1.0 - smoothstep(MID + 1.5, MID + 3.0, logY));
  float newLog = nb + detail + uClarity * mid * midMask + uSubjectLift * aux.a;
  lin *= exp2(newLog - log2(Y));

  // --- halation (red-orange bloom from bright sources, before development) ---
  lin += uHalTint * aux.b * uHalation;

  // --- dynamic range shoulder (DR100 / 200 / 400) ---
  float m = max(max(lin.r, lin.g), lin.b);
  float k = uShoulder.x;
  if (m > k) {
    float u = (m - k) / (1.0 - k);
    float w = (uShoulder.y - k) / (1.0 - k);
    float fu = u * (1.0 + u / (w * w)) / (1.0 + u);
    float fm = k + (1.0 - k) * min(fu, 1.0);
    lin *= fm / m;
    lin = mix(lin, vec3(fm), smoothstep(0.86, 1.0, fm) * 0.6);
  }

  vec3 enc = clamp(toSrgb(lin), 0.0, 1.0);

  // --- film simulation ---
  vec3 film = lut(uLut, enc);
  if (uSkin > 0.5) {
    float s = skinLikelihood(enc) * aux.a;
    if (s > 0.001) film = mix(film, lut(uLutSkin, enc), s);
  }
  film = mix(enc, film, uIntensity);

  // --- lens & print finishing ---
  vec2 cuv = (uv - uCrop.xy) / (uCrop.zw - uCrop.xy);
  vec2 asp = vec2(uFull.x * (uCrop.z - uCrop.x), uFull.y * (uCrop.w - uCrop.y));
  asp /= max(asp.x, asp.y);
  vec2 dc = (cuv - 0.5) * asp * 2.0;
  float r = length(dc) / length(asp);
  if (uVignette > 0.0) {
    float v = 1.0 - uVignette * pow(smoothstep(0.25, 1.1, r), 1.6) * 0.85;
    film = toSrgb(toLin(film) * v);
  }
  if (uLeak > 0.0) {
    float side = hash12(vec2(uLeakSeed, 3.1)) > 0.5 ? 1.0 : -1.0;
    vec2 c1 = vec2(side * 1.05, (hash12(vec2(uLeakSeed, 7.7)) - 0.5) * 1.2);
    vec2 c2 = c1 + vec2(-side * 0.25, 0.55);
    float g1 = exp(-dot(dc * vec2(1.0, 0.6) - c1, dc * vec2(1.0, 0.6) - c1) * 2.2);
    float g2 = exp(-dot(dc - c2, dc - c2) * 5.0);
    vec3 leak = vec3(1.0, 0.42, 0.12) * g1 + vec3(1.0, 0.18, 0.28) * g2 * 0.7;
    film = 1.0 - (1.0 - film) * (1.0 - clamp(leak * uLeak, 0.0, 1.0));
  }
  if (uGrain > 0.0) {
    vec2 px = uv * uFull / uGrainSize;
    float feature = uGrainSize / max(uScale, 1e-3);
    float amp = uGrain * min(1.0, feature);
    float l = dot(film, vec3(0.299, 0.587, 0.114));
    float wgt = 0.25 + 0.75 * pow(clamp(4.0 * l * (1.0 - l), 0.0, 1.0), 0.7);
    float g = grainAt(px);
    vec3 gc = vec3(grainAt(px + 31.7), grainAt(px + 77.3), grainAt(px + 143.9));
    film += (vec3(g) + (gc - g) * uGrainChroma) * amp * wgt;
  }
  frag = vec4(clamp(film, 0.0, 1.0), 1.0);
}`;
