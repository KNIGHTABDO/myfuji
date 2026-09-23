import { RECIPES, type Recipe } from '../film/recipes';
import { SIMS } from '../film/sims';
import { DEFAULT_PARAMS, type DevelopParams, type SimId } from '../film/types';
import type { ExifInfo } from '../exif';
import type { Lighting, Scene, Subject } from './scene';
import type { Stats } from './stats';
import type { VisionResult } from './vision';

export interface Pick { sim: SimId; score: number; reasons: string[] }
export interface Recommendation { picks: Pick[]; recipe: Recipe | null; recipeWhy: string }

type Table = Partial<Record<SimId, [number, string?]>>;

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
  const bump = (id: SimId, v: number, why?: string) => { const p = score.get(id)!; p.score += v; if (why) p.reasons.push(why); };
  if (st.colorfulness < 20) { bump('acros', 0.4, 'little colour to lose, lots of tone to gain'); bump('mono', 0.2); bump('classic-chrome', 0.15); }
  if (st.colorfulness > 65) { bump('classic-chrome', 0.2, 'tames very loud colour'); bump('eterna', 0.15); if (sc.subject !== 'nature' && sc.subject !== 'landscape') bump('velvia', -0.15); }
  if (st.colorfulness > 45) { bump('acros', -0.45); bump('mono', -0.3); bump('sepia', -0.2); }
  if (st.hueMass.orange + st.hueMass.yellow + st.hueMass.red > 0.3 && sc.subject !== 'portrait' && sc.subject !== 'group') { bump('nostalgic-neg', 0.25, 'rich warm colour to celebrate'); bump('velvia', 0.2); }
  if (st.hueMass.green > 0.2) { bump('velvia', 0.25, 'lots of foliage to enrich'); bump('classic-neg', 0.1); }
  if (st.sky.kind === 'blue') { bump('velvia', 0.2); bump('astia', 0.12); bump('acros', 0.1); }
  if (st.hueMass.orange > 0.25) bump('nostalgic-neg', 0.2, 'warm tones throughout');
  if (st.sky.kind === 'overcast' && st.contrast > 1.8) bump('eterna-bb', 0.2, 'dramatic sky for a bleach-bypass treatment');
  const picks = [...score.values()].sort((a, b) => b.score - a.score);
  for (const p of picks) p.reasons = [...new Set(p.reasons)].slice(0, 3);

  const tags = new Set<string>([sc.subject, sc.lighting, sc.time.inferred]);
  if (sc.subject === 'portrait' || sc.subject === 'group') tags.add('portrait');
  if (sc.lighting === 'tungsten' || sc.lighting === 'neon') tags.add('night');
  if (sc.subject === 'night-city') { tags.add('night'); tags.add('city'); }
  if (sc.lighting === 'overcast' || sc.lighting === 'low-key') tags.add('moody');
  if (sc.lighting === 'fluorescent') tags.add('mixed-light');
  let recipe: Recipe | null = null, best = 0;
  for (const r of RECIPES) {
    const hit = r.bestFor.filter((t) => tags.has(t)).length + (r.params.sim === picks[0].sim ? 0.5 : 0);
    if (hit > best) { best = hit; recipe = r; }
  }
  return { picks: picks.slice(0, 5), recipe: best >= 1 ? recipe : null, recipeWhy: recipe ? `Matches ${recipe.bestFor.filter((t) => tags.has(t)).join(' + ')}` : '' };
}

/** Camera-style settings tuned to this photograph for a given simulation. */
export function autoParams(sim: SimId, st: Stats, sc: Scene, v: VisionResult, exif: ExifInfo, base: DevelopParams = DEFAULT_PARAMS): DevelopParams {
  const p: DevelopParams = { ...base, sim };
  const isMono = sim === 'acros' || sim === 'mono' || sim === 'sepia';
  // Exposure: aim the scene's key at a mood-appropriate grey.
  const target = sc.lighting === 'night' || sc.lighting === 'neon' ? 0.07 : sc.lighting === 'low-key' || sc.lighting === 'blue-hour' ? 0.09 : sc.lighting === 'high-key' || sc.subject === 'snow' ? 0.28 : 0.16;
  // Dark-toned subjects (a black suit, autumn shade) are not underexposure: stay gentle.
  let ev = Math.log2(target / Math.max(st.key, 1e-4)) * 0.3;
  if (sc.faceLum !== null) {
    // People lead: expose for skin, borrowing a little from the scene.
    const evFace = Math.log2(0.3 / Math.max(sc.faceLum, 1e-4)) * 0.55;
    ev = evFace * 0.75 + ev * 0.25;
  }
  ev = Math.min(ev, 0.7);
  if (st.p.p99 * Math.pow(2, ev) > 1.6) ev = Math.min(ev, Math.log2(1.6 / Math.max(st.p.p99, 1e-4)));
  p.exposure = Math.round(Math.max(-1, Math.min(1.3, ev)) * 3) / 3;
  p.dr = 'auto';
  p.wbMode = 'auto';
  p.wbShiftR = 0; p.wbShiftB = 0;
  // Tone
  if (st.contrast > 2.4) { p.highlight = -1; p.shadow = -0.5; }
  else if (st.contrast < 1.3) { p.highlight = 0.5; p.shadow = 1; }
  else { p.highlight = 0; p.shadow = 0; }
  if (sim === 'eterna' || sim === 'pro-neg-std') p.shadow += 0.5;
  // Colour
  p.color = st.colorfulness < 18 ? 1 : st.colorfulness > 70 ? -1 : 0;
  if (sim === 'classic-chrome' && st.colorfulness < 35) p.color += 1;
  // Grain follows the light: more and bigger when the light was poor.
  const lowLight = (exif.iso ?? 0) >= 1600 || st.noise > 3.2 || sc.lighting === 'night' || sc.lighting === 'neon';
  if (sim === 'acros') { p.grain = lowLight ? 'strong' : 'weak'; p.grainSize = 'small'; }
  else if (lowLight) { p.grain = 'strong'; p.grainSize = 'large'; }
  else if (sc.subject === 'landscape' || sc.subject === 'food' || sc.subject === 'nature') p.grain = 'off';
  else { p.grain = 'weak'; p.grainSize = 'small'; }
  // Colour chrome
  p.cce = isMono ? 'off' : st.colorfulness > 40 || st.hueMass.red + st.hueMass.orange > 0.2 ? 'strong' : 'weak';
  p.cceBlue = isMono ? 'off' : st.sky.kind === 'blue' || st.hueMass.blue > 0.12 ? (sim === 'velvia' || sc.subject === 'landscape' ? 'strong' : 'weak') : 'off';
  // Texture
  const tex: Partial<Record<Subject, [number, number]>> = { landscape: [2, 1], architecture: [2, 1], street: [1, 0], food: [1, 1], nature: [1, 1], portrait: [-1, -1], group: [0, 0], 'still-life': [1, 0] };
  [p.clarity, p.sharpness] = tex[sc.subject] ?? [0, 0];
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
