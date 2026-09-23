import type { DevelopParams } from './types';

export interface Recipe {
  id: string;
  name: string;
  mood: string;
  /** Hand-picked situations where the recipe shines; used by the recommender. */
  bestFor: string[];
  params: Partial<DevelopParams>;
}

/** Original recipes in the spirit of the community "film recipe" culture around Fuji X cameras. */
export const RECIPES: Recipe[] = [
  {
    id: 'golden-hour-neg', name: 'Golden Hour Negative', mood: 'Amber light, soft glow, lifted warmth',
    bestFor: ['golden-hour', 'portrait', 'warm'],
    params: { sim: 'nostalgic-neg', wbMode: 'auto-ambience', wbShiftR: 2, wbShiftB: -4, dr: 400, highlight: -1, shadow: 0.5, color: 2, grain: 'weak', grainSize: 'small', cce: 'strong', cceBlue: 'off', halation: 0.18, clarity: -1 },
  },
  {
    id: 'street-400', name: 'Street 400', mood: 'Drugstore colour negative, snapshot punch',
    bestFor: ['street', 'urban', 'daylight'],
    params: { sim: 'classic-neg', wbMode: 'auto', wbShiftR: 1, wbShiftB: -2, dr: 200, highlight: 0.5, shadow: 1, color: 1, grain: 'strong', grainSize: 'small', cce: 'weak', cceBlue: 'off', vignette: 0.2, sharpness: 1 },
  },
  {
    id: 'chrome-doc', name: 'Chrome Documentary', mood: 'Warm slide, muted, reportage',
    bestFor: ['street', 'travel', 'overcast'],
    params: { sim: 'classic-chrome', wbMode: 'auto', wbShiftR: 2, wbShiftB: -5, dr: 200, highlight: 0, shadow: 1, color: 2, grain: 'weak', grainSize: 'small', cce: 'strong', cceBlue: 'weak', sharpness: 1, clarity: 1 },
  },
  {
    id: 'tungsten-800', name: 'Tungsten Night 800', mood: 'Cool tungsten stock, red halos around lights',
    bestFor: ['night', 'city', 'neon'],
    params: { sim: 'eterna', wbMode: 'kelvin', wbKelvin: 3900, wbShiftR: 1, wbShiftB: 0, dr: 400, highlight: -1, shadow: 1, color: 3, grain: 'strong', grainSize: 'large', cce: 'weak', cceBlue: 'off', halation: 0.65, vignette: 0.2 },
  },
  {
    id: 'vistas', name: 'Velvia Vistas', mood: 'Saturated slide for big landscapes',
    bestFor: ['landscape', 'nature', 'sunset'],
    params: { sim: 'velvia', wbMode: 'auto', wbShiftR: 0, wbShiftB: 0, dr: 400, highlight: -1, shadow: 1, color: 1, grain: 'off', cce: 'strong', cceBlue: 'strong', clarity: 2, sharpness: 1 },
  },
  {
    id: 'soft-portrait', name: 'Soft Portrait', mood: 'Kind to skin, quiet contrast',
    bestFor: ['portrait', 'people', 'indoor'],
    params: { sim: 'pro-neg-hi', wbMode: 'auto', wbShiftR: 1, wbShiftB: -1, dr: 200, highlight: -1, shadow: -1, color: 0, grain: 'weak', grainSize: 'small', cce: 'off', cceBlue: 'off', clarity: -2, sharpness: -1, skinProtect: true },
  },
  {
    id: 'cinema-teal', name: 'Cinema Teal', mood: 'Graded feature-film look',
    bestFor: ['cinematic', 'blue-hour', 'moody'],
    params: { sim: 'eterna', wbMode: 'auto', wbShiftR: -1, wbShiftB: 1, dr: 400, highlight: 0, shadow: 1.5, color: 1, grain: 'weak', grainSize: 'large', cce: 'weak', cceBlue: 'off', clarity: 1, vignette: 0.25 },
  },
  {
    id: 'bleach-grit', name: 'Bleach Bypass Grit', mood: 'Silver-heavy, metallic, hard',
    bestFor: ['dramatic', 'urban', 'overcast'],
    params: { sim: 'eterna-bb', wbMode: 'auto', wbShiftR: 0, wbShiftB: 0, dr: 200, highlight: 1, shadow: 2, color: 0, grain: 'strong', grainSize: 'large', clarity: 3, vignette: 0.3 },
  },
  {
    id: 'acros-red', name: 'Acros Red Filter', mood: 'Black skies, glowing clouds, crisp mono',
    bestFor: ['bw', 'sky', 'architecture'],
    params: { sim: 'acros', monoFilter: 'r', monoWC: 0, monoMG: 0, dr: 200, highlight: 1, shadow: 1, grain: 'strong', grainSize: 'small', clarity: 2, sharpness: 1 },
  },
  {
    id: 'silver-gelatin', name: 'Silver Gelatin', mood: 'Warm-toned fibre print',
    bestFor: ['bw', 'portrait', 'still life'],
    params: { sim: 'acros', monoFilter: 'ye', monoWC: 2, monoMG: 0, dr: 200, highlight: 0, shadow: 2, grain: 'weak', grainSize: 'small', clarity: 0 },
  },
  {
    id: 'faded-memory', name: 'Faded Memory', mood: 'Expired film from a shoebox',
    bestFor: ['nostalgic', 'snapshot'],
    params: { sim: 'classic-neg', wbMode: 'auto', wbShiftR: 2, wbShiftB: -1, dr: 400, highlight: -2, shadow: -1, color: -1, fade: 0.55, grain: 'strong', grainSize: 'large', lightLeak: 0.5, vignette: 0.25 },
  },
  {
    id: 'pastel-morning', name: 'Pastel Morning', mood: 'Airy, bright and soft',
    bestFor: ['high-key', 'portrait', 'interior'],
    params: { sim: 'pro-neg-std', wbMode: 'auto', wbShiftR: -1, wbShiftB: 1, exposure: 0.4, dr: 400, highlight: -1, shadow: -2, color: -1, fade: 0.25, grain: 'weak', grainSize: 'small', clarity: -1 },
  },
  {
    id: 'reala-everyday', name: 'Reala Everyday', mood: 'Honest colour with a little bite',
    bestFor: ['food', 'interior', 'mixed-light'],
    params: { sim: 'reala-ace', wbMode: 'auto-white', wbShiftR: 0, wbShiftB: 0, dr: 'auto', highlight: 0, shadow: 0.5, color: 1, grain: 'weak', grainSize: 'small', cce: 'weak', cceBlue: 'off', clarity: 1 },
  },
  {
    id: 'sepia-album', name: 'Sepia Album', mood: 'Grandparents’ photo album',
    bestFor: ['vintage'],
    params: { sim: 'sepia', dr: 400, highlight: -1, shadow: 0, fade: 0.3, grain: 'strong', grainSize: 'large', vignette: 0.35 },
  },
];
