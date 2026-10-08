import { clamp } from '../color';
import { RECIPES, type Recipe } from '../film/recipes';
import { SIMS } from '../film/sims';
import { DEFAULT_PARAMS, type DevelopParams, type SimId, type Strength } from '../film/types';
import type { ExifInfo } from '../exif';
import type { Lighting, Scene, Subject } from './scene';
import type { Stats } from './stats';
import type { VisionResult } from './vision';

export interface Pick { sim: SimId; score: number; reasons: string[] }
export interface Recommendation { picks: Pick[]; recipe: Recipe | null; recipeWhy: string }

type Table = Partial<Record<SimId, [number, string?]>>;

/** Sims that are never chosen automatically for colour input (monochrome, and bleach bypass). */
const MONO_SIMS: SimId[] = ['acros', 'mono', 'sepia', 'eterna-bb'];

/** Soft 0..1 smoothstep from lo to hi (either direction). */
const ramp = (x: number, lo: number, hi: number) => {
  const t = clamp((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
/** sRGB encoding of a linear value, for brightness checks in display terms. */
const toSrgb = (x: number) => {
  const c = clamp(x, 0, 1);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
};
const quarter = (x: number) => Math.round(x * 4) / 4 || 0;
const twentieth = (x: number) => Math.round(x * 20) / 20 || 0;
const half = (x: number) => Math.round(x * 2) / 2 || 0;

/** Warm low light: these sims keep the sun's colour; cool or punchy ones fight it. Scaled by warmLight. */
const WARM_MOOD: Table = {
  'nostalgic-neg': [0.6, 'keeps the warm low sun'], 'classic-neg': [0.25, 'warm, punchy negatives'], 'pro-neg-std': [0.2, 'soft warm tonality'],
  'reala-ace': [0.15], eterna: [0.1], astia: [0.1], provia: [-0.35, 'would cool the warm light'], 'classic-chrome': [-0.2], velvia: [-0.5],
};

const BASE: Record<SimId, number> = {
  provia: 0.5, 'reala-ace': 0.45, 'classic-chrome': 0.45, 'classic-neg': 0.45, astia: 0.35, 'pro-neg-hi': 0.35, 'nostalgic-neg': 0.35,
  velvia: 0.3, eterna: 0.3, 'pro-neg-std': 0.25, acros: 0.3, mono: 0.1, 'eterna-bb': 0.15, sepia: 0.02,
};

const BY_SUBJECT: Partial<Record<Subject, Table>> = {
  portrait: { astia: [0.5, 'gentle on skin'], 'pro-neg-hi': [0.6, 'flattering skin with clean contrast'], 'pro-neg-std': [0.4, 'soft portrait tonality'], 'nostalgic-neg': [0.3, 'warm, storytelling skin'], 'classic-neg': [0.15], velvia: [-0.6, 'too harsh on skin'], 'eterna-bb': [-0.3], acros: [0.2, 'timeless in black & white'] },
  group: { 'pro-neg-hi': [0.55, 'keeps many skin tones natural'], astia: [0.4], 'classic-neg': [0.25], velvia: [-0.5] },
  people: { 'classic-chrome': [0.4, 'documentary feel for candid people'], 'classic-neg': [0.4], 'pro-neg-hi': [0.2] },
  street: { 'classic-chrome': [0.6, 'the classic street reportage look'], 'classic-neg': [0.55, 'snapshot colour-negative punch'], acros: [0.35, 'street photography in silver'], 'eterna-bb': [0.2] },
  landscape: { velvia: [0.8, 'built for landscapes: deep skies, rich greens'], provia: [0.3, 'faithful and clean for scenery'], acros: [0.15], eterna: [0.1] },
  architecture: { 'classic-chrome': [0.4, 'muted colour lets lines and form lead'], acros: [0.45, 'geometry shines in black & white'], provia: [0.2], 'eterna-bb': [0.25] },
  food: { 'reala-ace': [0.6, 'honest, appetising colour'], velvia: [0.3, 'makes colours pop on the plate'], provia: [0.3], astia: [0.2], acros: [-0.4, 'food needs colour'], eterna: [-0.3], 'classic-chrome': [-0.2] },
  animal: { provia: [0.3, 'true fur and feather colour'], astia: [0.3], 'reala-ace': [0.2] },
  nature: { velvia: [0.6, 'saturated detail for nature close-ups'], astia: [0.3], provia: [0.25] },
  'night-city': { 'classic-neg': [0.5, 'city lights with teal shadows'], eterna: [0.5, 'cinematic night mood'], acros: [0.35, 'noir'], 'classic-chrome': [0.2] },
  interior: { 'reala-ace': [0.35, 'handles indoor light faithfully'], 'nostalgic-neg': [0.35, 'cosy warmth indoors'], 'classic-neg': [0.2], 'pro-neg-std': [0.2] },
  vehicle: { 'classic-chrome': [0.4, 'magazine-style car colour'], velvia: [0.2], 'classic-neg': [0.25] },
  beach: { astia: [0.4, 'airy sea and skin'], provia: [0.3], 'classic-neg': [0.3], velvia: [0.2] },
  snow: { provia: [0.3], astia: [0.3], acros: [0.3, 'graphic winter mono'], 'classic-chrome': [0.2] },
  'still-life': { 'reala-ace': [0.3], 'classic-chrome': [0.3], 'nostalgic-neg': [0.3, 'painterly, warm still life'], acros: [0.25] },
};

const BY_LIGHT: Partial<Record<Lighting, Table>> = {
  'golden-hour': { 'nostalgic-neg': [0.7, 'made for amber, low-sun light'], 'classic-neg': [0.35], velvia: [0.25], astia: [0.2] },
  'blue-hour': { eterna: [0.5, 'holds the soft blue gradients of dusk'], 'classic-chrome': [0.3], velvia: [0.2] },
  night: { eterna: [0.35, 'gentle shadows for night'], 'classic-neg': [0.4, 'punchy night colour'], acros: [0.35] },
  neon: { 'classic-neg': [0.35], eterna: [0.4, 'cinema neon'], velvia: [0.2] },
  tungsten: { 'nostalgic-neg': [0.35, 'embraces warm lamplight'], 'classic-neg': [0.3], eterna: [0.2], 'reala-ace': [0.2] },
  fluorescent: { 'reala-ace': [0.45, 'most faithful under mixed light'], 'classic-chrome': [0.25], acros: [0.3, 'sidesteps ugly colour casts'] },
  overcast: { 'classic-chrome': [0.5, 'loves flat, overcast light'], eterna: [0.35], acros: [0.3], velvia: [0.15, 'adds punch to grey days'] },
  'harsh-sun': { 'classic-neg': [0.4, 'hard light suits its crisp look'], 'classic-chrome': [0.3], eterna: [0.25, 'tames hard contrast'], astia: [0.2] },
  daylight: { provia: [0.25], velvia: [0.15] },
  backlit: { eterna: [0.3, 'wide latitude for backlight'], 'pro-neg-std': [0.25], astia: [0.2], 'nostalgic-neg': [0.2] },
  'low-key': { acros: [0.4, 'deep blacks for a dark mood'], 'eterna-bb': [0.3], 'classic-chrome': [0.2] },
  'high-key': { astia: [0.35, 'airy highlights'], 'pro-neg-std': [0.3], 'nostalgic-neg': [0.1] },
};

export function recommend(st: Stats, sc: Scene): Recommendation {
  const score = new Map<SimId, Pick>();
  for (const s of SIMS) score.set(s.id, { sim: s.id, score: BASE[s.id], reasons: [] });
  const apply = (t: Table | undefined, w = 1) => {
    if (!t) return;
    for (const [id, [v, why]] of Object.entries(t) as Array<[SimId, [number, string?]]>) {
      const p = score.get(id)!;
      p.score += v * w;
      if (why && v > 0) p.reasons.push(why);
    }
  };
  apply(BY_SUBJECT[sc.subject]);
  if (sc.subjectScores[1] && sc.subjectScores[1][1] > 0.5) apply(BY_SUBJECT[sc.subjectScores[1][0]], 0.4);
  apply(BY_LIGHT[sc.lighting]);
  if (sc.lightingScores[1] && sc.lightingScores[1][1] > 0.7) apply(BY_LIGHT[sc.lightingScores[1][0]], 0.35);
  apply(WARM_MOOD, sc.warmLight);
  const bump = (id: SimId, v: number, why?: string) => { const p = score.get(id)!; p.score += v; if (why) p.reasons.push(why); };
  if (st.colorfulness < 20) { bump('acros', 0.4, 'little colour to lose, lots of tone to gain'); bump('mono', 0.2); bump('classic-chrome', 0.15); }
  if (st.colorfulness > 65) { bump('classic-chrome', 0.2, 'tames very loud colour'); bump('eterna', 0.15); if (sc.subject !== 'nature' && sc.subject !== 'landscape') bump('velvia', -0.15); }
  if (st.colorfulness > 45) { bump('acros', -0.45); bump('mono', -0.3); bump('sepia', -0.2); }
  if (st.hueMass.orange + st.hueMass.yellow + st.hueMass.red > 0.3 && sc.subject !== 'portrait' && sc.subject !== 'group') { bump('nostalgic-neg', 0.25, 'rich warm colour to celebrate'); bump('velvia', 0.2); }
  if (st.hueMass.green > 0.2) { bump('velvia', 0.25, 'lots of foliage to enrich'); bump('classic-neg', 0.1); }
  if (st.sky.kind === 'blue') { bump('velvia', 0.2); bump('astia', 0.12); bump('acros', 0.1); }
  if (st.hueMass.orange > 0.25) bump('nostalgic-neg', 0.2, 'warm tones throughout');
  if (st.sky.kind === 'overcast' && st.contrast > 1.8) bump('eterna-bb', 0.2, 'dramatic sky for a bleach-bypass treatment');
  // Colour input never gets a monochrome sim or bleach bypass automatically; near-grey input may.
  const greyInput = st.colorfulness < 8;
  const allowed = (id: SimId) => greyInput || !MONO_SIMS.includes(id);
  const picks = [...score.values()].filter((p) => allowed(p.sim)).sort((a, b) => b.score - a.score);
  for (const p of picks) p.reasons = [...new Set(p.reasons)].slice(0, 3);

  const tags = new Set<string>([sc.subject, sc.lighting, sc.time.inferred]);
  if (sc.subject === 'portrait' || sc.subject === 'group') tags.add('portrait');
  if (sc.lighting === 'tungsten' || sc.lighting === 'neon') tags.add('night');
  if (sc.subject === 'night-city') { tags.add('night'); tags.add('city'); }
  if (sc.lighting === 'overcast' || sc.lighting === 'low-key') tags.add('moody');
  if (sc.lighting === 'fluorescent') tags.add('mixed-light');
  let recipe: Recipe | null = null, best = 0;
  for (const r of RECIPES) {
    if (r.params.sim && !allowed(r.params.sim)) continue;
    const hit = r.bestFor.filter((t) => tags.has(t)).length + (r.params.sim === picks[0].sim ? 0.5 : 0);
    if (hit > best) { best = hit; recipe = r; }
  }
  return { picks: picks.slice(0, 5), recipe: best >= 1 ? recipe : null, recipeWhy: recipe ? `Matches ${recipe.bestFor.filter((t) => tags.has(t)).join(' + ')}` : '' };
}

/** Camera-style settings tuned to this photograph for a given simulation. */
export function autoParams(sim: SimId, st: Stats, sc: Scene, v: VisionResult, exif: ExifInfo, base: DevelopParams = DEFAULT_PARAMS): DevelopParams {
  const p: DevelopParams = { ...base, sim };
  const isMono = sim === 'acros' || sim === 'mono' || sim === 'sepia';
  const warm = sc.warmLight;
  // Gentleness: the share of each automatic move that survives (screenshots and graded files get fewer moves).
  const g = 1 - 0.6 * sc.gentle;
  const meanS = toSrgb(st.key);
  const moody = warm >= 0.5 || sc.backlight >= 0.5 || ['golden-hour', 'blue-hour', 'night', 'neon', 'low-key'].includes(sc.lighting);
  // Genuinely dark frames may be lifted a lot; everything else gets a small, capped move. A frame is not underexposed
  // when its highlights reach 0.45 sRGB or a face is lit (dark moody portraits with a lit face stay gentle).
  const litFace = sc.faceLum !== null && toSrgb(sc.faceLum) >= 0.4;
  const lit = toSrgb(st.p.p99) >= 0.45 || litFace;
  const badlyExposed = !lit && (meanS < 0.12 || st.p.p99 < 0.6);

  // Exposure: aim the scene's key at a mood-appropriate grey.
  const target = sc.lighting === 'night' || sc.lighting === 'neon' ? 0.07 : sc.lighting === 'low-key' || sc.lighting === 'blue-hour' ? 0.09 : sc.lighting === 'high-key' || sc.subject === 'snow' ? 0.28 : 0.16;
  // Dark-toned subjects (a black suit, autumn shade) are not underexposure: stay gentle.
  let ev = Math.log2(target / Math.max(st.key, 1e-4)) * 0.3;
  if (sc.faceLum !== null) {
    // People lead: expose for skin, borrowing a little from the scene.
    const evFace = Math.log2(0.3 / Math.max(sc.faceLum, 1e-4)) * 0.55;
    ev = evFace * 0.75 + ev * 0.25;
  }
  // A mid-key frame with no faces is already where it should be.
  if (sc.faceLum === null && st.key >= 0.12 && st.key <= 0.25) ev = 0;
  // Golden, backlit and night light is the look: never brighten it, unless the people in a dim frame are clearly dark.
  if (moody && !(sc.subjectDeficit > 0.6 && !lit)) ev = Math.min(ev, 0);
  // Bright frames (p99 above 0.95 sRGB) are not lifted at all.
  if (toSrgb(st.p.p99) > 0.95) ev = 0;
  if (st.p.p99 * Math.pow(2, ev) > 1.6) ev = Math.min(ev, Math.log2(1.6 / Math.max(st.p.p99, 1e-4)));
  // Moody and low-key scenes never get more than +0.33, whatever the face reading says.
  const lo = badlyExposed ? -1 : -0.33;
  const hi = moody ? 0.33 : badlyExposed ? 1.3 : 0.33;
  ev = Math.max(lo, Math.min(hi, ev));
  // Average brightness may move by at most about 0.04 sRGB unless the frame is badly exposed.
  if (!badlyExposed) {
    while (Math.abs(ev) > 0.01 && Math.abs(toSrgb(st.key * Math.pow(2, ev)) - meanS) > 0.04) ev -= Math.sign(ev) * 0.02;
  }
  p.exposure = twentieth(ev * g);
  p.dr = 'auto';
  // Warm light is kept as shot; the auto white balance would otherwise neutralise the sun.
  p.wbMode = warm >= 0.5 ? 'as-shot' : 'auto';
  p.wbShiftR = 0; p.wbShiftB = 0;

  // Tone: flat frames get a little contrast, very contrasty ones are eased. Warm light keeps its highlights and does not lift shadows.
  const flat = ramp(st.contrast, 1.3, 0.9);
  const punchy = ramp(st.contrast, 1.9, 2.6);
  let H = 0.5 * flat - 1 * punchy;
  let S = 1 * flat - 0.5 * punchy; // +S deepens shadows, -S lifts them
  if (warm >= 0.5) { H = Math.min(H, 0); S = Math.max(S, 0) * 0.5; }
  if (sim === 'eterna' || sim === 'pro-neg-std') S += 0.5 * (1 - warm);
  p.highlight = quarter(H * g);
  p.shadow = quarter(S * g);

  // Colour: never boost an already saturated frame, never reduce warm light.
  let color = st.colorfulness < 18 ? 1 : st.colorfulness > 70 ? -1 : 0;
  if (sim === 'classic-chrome' && st.colorfulness < 35) color += 1;
  if (st.colorfulness > 45) color = Math.min(color, 0);
  if (warm >= 0.5 && color < 0) color = 0;
  p.color = quarter(color * g);

  // Small or compressed inputs (screenshots, graded files, phone-size images) get less grain and no added sharpening.
  const edge = Math.max(exif.width ?? 0, exif.height ?? 0);
  const small = (edge > 0 && edge <= 1600) || sc.inputKind === 'screenshot' || sc.inputKind === 'graded';
  // Grain follows the light: more and bigger when the light was poor.
  const lowLight = (exif.iso ?? 0) >= 1600 || st.noise > 3.2 || sc.lighting === 'night' || sc.lighting === 'neon';
  if (sim === 'acros') { p.grain = lowLight ? 'strong' : 'weak'; p.grainSize = 'small'; }
  else if (lowLight) { p.grain = 'strong'; p.grainSize = 'large'; }
  else if (sc.subject === 'landscape' || sc.subject === 'food' || sc.subject === 'nature') p.grain = 'off';
  else { p.grain = 'weak'; p.grainSize = 'small'; }
  const order: Strength[] = ['off', 'weak', 'strong'];
  const drop = small || sc.gentle >= 0.4 ? 1 : 0;
  p.grain = order[Math.max(0, order.indexOf(p.grain) - drop)];
  // Colour chrome
  p.cce = isMono ? 'off' : st.colorfulness > 40 || st.hueMass.red + st.hueMass.orange > 0.2 ? 'strong' : 'weak';
  p.cceBlue = isMono ? 'off' : st.sky.kind === 'blue' || st.hueMass.blue > 0.12 ? (sim === 'velvia' || sc.subject === 'landscape' ? 'strong' : 'weak') : 'off';
  // Texture
  const tex: Partial<Record<Subject, [number, number]>> = { landscape: [2, 1], architecture: [2, 1], street: [1, 0], food: [1, 1], nature: [1, 1], portrait: [-1, -1], group: [0, 0], 'still-life': [1, 0] };
  const [clar, sharp] = tex[sc.subject] ?? [0, 0];
  p.clarity = half(clar * g);
  p.sharpness = half((small ? Math.min(sharp, 0) : sharp) * g);
  p.halation = (sc.lighting === 'night' || sc.lighting === 'neon') && st.pointLights > 2 ? (sim === 'eterna' || sim === 'classic-neg' ? 0.4 : 0.2) : 0;
  p.vignette = sc.subject === 'portrait' ? 0.15 : sc.subject === 'street' || sc.subject === 'night-city' ? 0.2 : 0.1;
  p.monoFilter = st.sky.kind === 'blue' ? 'r' : st.hueMass.green > 0.25 ? 'g' : 'ye';
  p.skinProtect = v.faces.length > 0;
  p.smartLight = 0.5;
  p.subjectLift = 0.5;
  p.cropCenter = sc.saliency;
  p.intensity = 1;
  return p;
}
