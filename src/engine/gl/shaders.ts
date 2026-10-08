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
uniform sampler2D uAux;   // r: base log2 luma (WB applied), g: mid-frequency log2 luma (WB applied), b: halation energy, a: subject mask
uniform sampler2D uRegions; // r: sky, g: foliage, b: ground, a: sun (work grid, LINEAR, CLAMP)
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
uniform vec2 uShoulder;    // x: knee (0..1), y: white point (informational)
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
uniform float uRegionAmt;  // regions x (1 - 0.5 gentle); 0 = off
uniform float uWarm;       // scene warm-light score 0..1
uniform float uBack;       // scene backlight score 0..1

const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
const float MID = -2.4739; // log2(0.18)
const float PI = 3.14159265;
const float TAU = 6.28318531;

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

// ---- OKLab (Ottosson), same constants as src/engine/color.ts ----
float cbrt1(float x) { return pow(max(x, 0.0), 1.0 / 3.0); }
vec3 linToOk(vec3 c) {
  float l = cbrt1(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
  float m = cbrt1(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
  float s = cbrt1(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 okToLin(vec3 o) {
  float l = o.x + 0.3963377774 * o.y + 0.2158037573 * o.z;
  float m = o.x - 0.1055613458 * o.y - 0.0638541728 * o.z;
  float s = o.x - 0.0894841775 * o.y - 1.2914855480 * o.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
float wrapPi(float x) { return mod(x + PI, TAU) - PI; }
// Hue nudge toward a target hue (radians): a fraction of the distance, capped at maxRad.
float hueStep(float h, float target, float maxRad) { return clamp(wrapPi(target - h) * 0.35, -maxRad, maxRad); }

// Per-region looks, in display space after toSrgb and before the film LUT. Every term is
// weighted by a smooth region weight, so where the masks are 0 the colour is unchanged.
vec3 regionGrade(vec3 enc, vec4 R) {
  float amt = uRegionAmt;
  vec3 ok = linToOk(toLin(enc));
  float L = ok.x, C = length(ok.yz);
  float h = atan(ok.z + 1e-9, ok.y);
  float sky = clamp(R.r, 0.0, 1.0), fol = clamp(R.g, 0.0, 1.0), gnd = clamp(R.b, 0.0, 1.0), sun = clamp(R.a, 0.0, 1.0);
  float warmK = smoothstep(0.25, 0.6, uWarm);
  float wm = smoothstep(0.02, 0.09, C);            // chroma gate: never lift noise in flat areas
  float wSF = fol * sun * amt, wShF = fol * (1.0 - sun) * amt;
  float wGS = gnd * sun * amt, wGSh = gnd * (1.0 - sun) * amt;
  float wSky = sky * amt;
  float blue = 1.0 - smoothstep(0.35, 0.9, abs(wrapPi(h + 1.8326))); // ~255 deg

  float dL = 0.0, dC = 0.0, dH = 0.0, da = 0.0, db = 0.0;
  // Sunlit foliage: golden yellow-green, a touch richer and brighter when warm; translucent glow when backlit.
  dH += wSF * hueStep(h, 2.18, 0.21);
  dC += 0.08 * wSF;
  dL += wSF * (0.012 * warmK + 0.025 * uBack * smoothstep(0.5, 0.9, L));
  // Shaded foliage: deeper emerald, a little darker and richer.
  dH += wShF * hueStep(h, 2.618, 0.21);
  dL -= 0.03 * wShF;
  dC += 0.05 * wShF;
  // Sky: warm light pulls it toward cream/peach and pulls the top highlights down; cool sky deepens a little.
  float skyW = wSky * warmK;
  dH += skyW * hueStep(h, 1.134, 0.14);
  dC -= 0.05 * skyW;
  dL -= 0.025 * skyW * smoothstep(0.75, 0.97, L);
  float skyC = wSky * (1.0 - warmK) * blue;
  dL -= 0.02 * skyC;
  dC += 0.08 * skyC * wm;
  // Ground: sunlit toward amber when warm; shaded ground slightly cool.
  dH += wGS * hueStep(h, 1.2217, 0.17);
  da += 0.004 * warmK * wGS;
  db += 0.012 * warmK * wGS;
  db -= 0.008 * wGSh;
  // Global warm-light finish: warm highlights, very slightly teal shadows (scaled by the regions amount, so Regions 0 is a no-op).
  float fin = warmK * amt;
  float hiW = smoothstep(0.5, 0.95, L), loW = 1.0 - smoothstep(0.2, 0.5, L);
  db += fin * (0.010 * hiW - 0.003 * loW);
  da -= fin * 0.003 * loW;

  float Ln = L + clamp(dL, -0.04, 0.04);
  float Cn = C * clamp(1.0 + dC, 0.9, 1.15);
  float hn = h + clamp(dH, -0.21, 0.21);
  vec3 o = vec3(Ln, Cn * cos(hn) + da, Cn * sin(hn) + db);
  return clamp(toSrgb(clamp(okToLin(o), 0.0, 1.0)), 0.0, 1.0);
}

void main() {
  vec2 o = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlipY));
  vec2 uv = mix(uView.xy, uView.zw, o);
  vec3 src = texture(uSrc, uv).rgb;

  if (uOriginal > 0.5 || o.x < uSplit) {
    frag = vec4(toSrgb(src), 1.0);
    return;
  }

  // --- sharpening / softening on luminance, radius fixed at one SOURCE pixel (LOD 0), so preview == export ---
  vec3 lin = src;
  if (abs(uSharp) > 0.001) {
    vec2 t = 1.0 / uFull;
    float yc = dot(textureLod(uSrc, uv, 0.0).rgb, LW);
    float yn = dot(textureLod(uSrc, uv + vec2(t.x, 0.0), 0.0).rgb, LW) + dot(textureLod(uSrc, uv - vec2(t.x, 0.0), 0.0).rgb, LW)
             + dot(textureLod(uSrc, uv + vec2(0.0, t.y), 0.0).rgb, LW) + dot(textureLod(uSrc, uv - vec2(0.0, t.y), 0.0).rgb, LW);
    float ys = max(yc + uSharp * (yc - yn * 0.25), 0.0);
    lin *= yc > 1e-5 ? ys / yc : 1.0;
  }

  // --- white balance & exposure with adaptive local tone mapping (base layer is built from WB-applied luma) ---
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

  // --- highlight shoulder: hue-preserving on luminance, C1 at the knee, asymptotic to 1 ---
  float k = uShoulder.x;
  float Lw = dot(lin, LW);
  if (Lw > k) {
    float t = 1.0 - k;
    lin *= (1.0 - t * exp(-(Lw - k) / t)) / Lw;
  }
  // Gamut: if a channel still exceeds 1, desaturate toward the same luminance just enough to bring it to 1.
  // Neutral input (and anything in gamut) is untouched, so white stays white and nothing picks up a tint.
  float Lo = dot(lin, LW);
  float mx = max(max(lin.r, lin.g), lin.b);
  if (mx > 1.0) {
    float lam = (1.0 - Lo) / max(mx - Lo, 1e-6);
    lin = Lo + (lin - Lo) * clamp(lam, 0.0, 1.0);
  }

  vec3 enc = clamp(toSrgb(lin), 0.0, 1.0);

  // --- per-region looks (sky, foliage, ground, sun) in OKLab, before the film ---
  if (uRegionAmt > 1e-4) enc = regionGrade(enc, texture(uRegions, uv));

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
    // Luminance-only darkening in display (sRGB) space: a gentle falloff, no colour cast.
    float v = 1.0 - uVignette * 0.45 * pow(smoothstep(0.3, 1.15, r), 2.0);
    film *= v;
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
  // --- output dither: triangular PDF, +-1 LSB per pixel, kills 8-bit banding in smooth gradients ---
  vec2 pix = floor(uv * uFull) + 0.5;
  float dith = hash12(pix) + hash12(pix + vec2(37.1, 11.7)) - 1.0;
  frag = vec4(clamp(film + dith / 255.0, 0.0, 1.0), 1.0);
}`;
