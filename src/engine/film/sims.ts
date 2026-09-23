import type { SimId } from './types';

/**
 * A film simulation, described the way a colour scientist would tune it:
 * a tone curve in display space, a global saturation, hue-selective edits in
 * OKLab and a split tone. Values are original tunings that aim for the
 * character of each Fujifilm simulation. They are not Fujifilm's own data.
 *
 * hue controls: [okHue°, hueShift°, saturation×, lightness shift for saturated colours]
 * OKLab reference hues: red 29, orange/skin 55–65, yellow 110, green 142, cyan 195, blue 264, magenta 328.
 */
export interface SimDef {
  id: SimId;
  name: string;
  dial: string;
  family: 'colour' | 'negative' | 'cine' | 'mono';
  blurb: string;
  character: string[];
  tone: Array<[number, number]>;
  /** 0 = luminance-preserving curve, 1 = per-channel curve (more crossover, film-like). */
  channelMix: number;
  sat: number;
  hue: Array<[number, number, number, number]>;
  splitShadow: [number, number];
  splitHighlight: [number, number];
  mono?: { weights: Record<'std' | 'ye' | 'r' | 'g', [number, number, number]>; tint?: [number, number] };
  /** Default grain character hint for the recommender. */
  grainBias?: number;
}

const neutralHue: SimDef['hue'] = [
  [29, 0, 1, 0], [60, 0, 1, 0], [110, 0, 1, 0], [142, 0, 1, 0], [195, 0, 1, 0], [264, 0, 1, 0], [328, 0, 1, 0],
];

const MONO_WEIGHTS: NonNullable<SimDef['mono']>['weights'] = {
  std: [0.3, 0.59, 0.11],
  ye: [0.36, 0.58, 0.06],
  r: [0.62, 0.35, 0.03],
  g: [0.18, 0.74, 0.08],
};

export const SIMS: SimDef[] = [
  {
    id: 'provia', name: 'Provia', dial: 'PROVIA/STD', family: 'colour',
    blurb: 'The all-rounder. True-to-life colour with a clean, gentle S-curve.',
    character: ['balanced', 'natural', 'everyday'],
    tone: [[0, 0], [0.1, 0.086], [0.25, 0.234], [0.5, 0.508], [0.75, 0.778], [0.9, 0.918], [1, 1]],
    channelMix: 0.25, sat: 1.08,
    hue: [[29, 0, 1.06, -0.005], [60, 1, 1.0, 0.005], [110, -2, 1.04, 0], [142, 0, 1.04, -0.01], [195, 0, 1.02, 0], [264, -2, 1.06, -0.015], [328, 0, 1.02, 0]],
    splitShadow: [0, 0], splitHighlight: [0.002, 0.004],
  },
  {
    id: 'velvia', name: 'Velvia', dial: 'VELVIA/VIVID', family: 'colour',
    blurb: 'Saturated slide film. Deep skies, electric greens, punchy contrast.',
    character: ['vivid', 'landscape', 'high contrast'],
    tone: [[0, 0], [0.1, 0.068], [0.25, 0.206], [0.5, 0.5], [0.75, 0.8], [0.9, 0.936], [1, 1]],
    channelMix: 0.4, sat: 1.32,
    hue: [[29, 1, 1.14, -0.03], [60, -2, 1.1, -0.01], [110, -5, 1.16, -0.01], [142, 5, 1.3, -0.045], [195, 2, 1.18, -0.03], [264, -1, 1.14, -0.06], [328, 0, 1.18, -0.025]],
    splitShadow: [0.002, -0.004], splitHighlight: [0, 0.004],
  },
  {
    id: 'astia', name: 'Astia', dial: 'ASTIA/SOFT', family: 'colour',
    blurb: 'Soft slide film for people. Gentle skin, lively blues and greens.',
    character: ['soft', 'portrait', 'fashion'],
    tone: [[0, 0.004], [0.1, 0.096], [0.25, 0.246], [0.5, 0.514], [0.75, 0.768], [0.9, 0.902], [1, 0.994]],
    channelMix: 0.2, sat: 1.04,
    hue: [[29, 0, 1.0, 0], [55, 1, 0.92, 0.018], [110, -1, 1.06, 0], [142, -2, 1.06, -0.01], [195, 0, 1.1, -0.01], [264, -3, 1.16, -0.025], [328, 0, 1.0, 0]],
    splitShadow: [0, -0.002], splitHighlight: [0.002, 0.004],
  },
  {
    id: 'classic-chrome', name: 'Classic Chrome', dial: 'CLASSIC CHROME', family: 'colour',
    blurb: 'Documentary reversal film. Muted colour, hard shadows, cyan-leaning skies.',
    character: ['muted', 'street', 'documentary'],
    tone: [[0, 0], [0.1, 0.078], [0.25, 0.222], [0.5, 0.498], [0.75, 0.764], [0.9, 0.9], [1, 0.986]],
    channelMix: 0.3, sat: 0.8,
    hue: [[29, 4, 0.82, -0.04], [60, -2, 0.88, -0.005], [110, -9, 0.74, -0.02], [142, -10, 0.7, -0.03], [195, -5, 0.86, -0.02], [264, -18, 0.82, -0.055], [328, -6, 0.78, -0.02]],
    splitShadow: [-0.004, -0.006], splitHighlight: [0.003, 0.008],
  },
  {
    id: 'reala-ace', name: 'Reala Ace', dial: 'REALA ACE', family: 'colour',
    blurb: 'Faithful colour with a harder tonality. Honest under mixed light.',
    character: ['faithful', 'crisp', 'mixed light'],
    tone: [[0, 0], [0.1, 0.082], [0.25, 0.228], [0.5, 0.504], [0.75, 0.784], [0.9, 0.926], [1, 1]],
    channelMix: 0.25, sat: 1.05,
    hue: [[29, 1, 1.04, -0.01], [58, 0, 1.0, 0.006], [110, -2, 1.02, 0], [142, -2, 1.0, -0.01], [195, 0, 1.02, 0], [264, -2, 1.05, -0.015], [328, 0, 1.02, 0]],
    splitShadow: [0, 0], splitHighlight: [0.002, 0.003],
  },
  {
    id: 'pro-neg-hi', name: 'Pro Neg. Hi', dial: 'PRO Neg. Hi', family: 'negative',
    blurb: 'Portrait negative with a bit of bite. Flattering skin, clean contrast.',
    character: ['portrait', 'outdoor', 'natural skin'],
    tone: [[0, 0.002], [0.1, 0.09], [0.25, 0.236], [0.5, 0.51], [0.75, 0.78], [0.9, 0.914], [1, 0.996]],
    channelMix: 0.3, sat: 0.98,
    hue: [[29, 2, 1.0, 0], [55, 0, 0.95, 0.014], [110, -3, 0.98, 0], [142, -3, 0.94, -0.01], [195, 0, 0.98, 0], [264, -3, 1.0, -0.01], [328, 0, 0.96, 0]],
    splitShadow: [0, -0.002], splitHighlight: [0.002, 0.004],
  },
  {
    id: 'pro-neg-std', name: 'Pro Neg. Std', dial: 'PRO Neg. Std', family: 'negative',
    blurb: 'Studio portrait negative. The softest tonality, subdued and smooth.',
    character: ['soft', 'studio', 'subtle'],
    tone: [[0, 0.01], [0.1, 0.101], [0.25, 0.25], [0.5, 0.51], [0.75, 0.758], [0.9, 0.894], [1, 0.984]],
    channelMix: 0.3, sat: 0.9,
    hue: [[29, 1, 0.92, 0], [55, 0, 0.92, 0.018], [110, -4, 0.9, 0], [142, -4, 0.85, 0], [195, -2, 0.9, 0], [264, -6, 0.9, 0], [328, 0, 0.9, 0]],
    splitShadow: [-0.002, -0.003], splitHighlight: [0.001, 0.002],
  },
  {
    id: 'classic-neg', name: 'Classic Neg.', dial: 'CLASSIC Neg.', family: 'negative',
    blurb: 'Everyday colour negative. Hard tonality, teal shadows, amber-shifted colour.',
    character: ['nostalgic', 'street', 'crossover'],
    tone: [[0, 0], [0.1, 0.07], [0.25, 0.205], [0.5, 0.49], [0.75, 0.79], [0.9, 0.93], [1, 1]],
    channelMix: 0.5, sat: 0.96,
    hue: [[29, 6, 1.1, -0.025], [60, -2, 1.0, 0], [110, -12, 0.9, -0.02], [142, 14, 0.84, -0.035], [195, -4, 1.0, -0.02], [264, -15, 0.9, -0.03], [328, 6, 0.9, 0]],
    splitShadow: [-0.012, -0.007], splitHighlight: [0.004, 0.012],
  },
  {
    id: 'nostalgic-neg', name: 'Nostalgic Neg.', dial: 'NOSTALGIC Neg.', family: 'negative',
    blurb: 'Amber highlights and rich shadows, like a 1970s colour print.',
    character: ['warm', 'amber', 'storytelling'],
    tone: [[0, 0.014], [0.1, 0.1], [0.25, 0.244], [0.5, 0.5], [0.75, 0.762], [0.9, 0.9], [1, 0.986]],
    channelMix: 0.4, sat: 1.02,
    hue: [[29, 4, 1.06, -0.01], [60, -2, 1.08, 0.008], [110, -8, 1.08, 0], [142, -10, 0.9, -0.01], [195, -2, 0.92, 0], [264, -6, 0.9, 0], [328, 2, 0.95, 0]],
    splitShadow: [0.002, 0.004], splitHighlight: [0.006, 0.022],
  },
  {
    id: 'eterna', name: 'Eterna', dial: 'ETERNA/CINEMA', family: 'cine',
    blurb: 'Motion-picture stock. Low contrast, muted colour, teal shadows.',
    character: ['cinematic', 'moody', 'low contrast'],
    tone: [[0, 0.026], [0.1, 0.112], [0.25, 0.256], [0.5, 0.49], [0.75, 0.736], [0.9, 0.87], [1, 0.965]],
    channelMix: 0.25, sat: 0.72,
    hue: [[29, 2, 0.82, 0], [60, 0, 0.86, 0.006], [110, -4, 0.78, 0], [142, 6, 0.74, -0.01], [195, 0, 0.82, 0], [264, -10, 0.8, 0], [328, 0, 0.78, 0]],
    splitShadow: [-0.01, -0.012], splitHighlight: [0.002, 0.006],
  },
  {
    id: 'eterna-bb', name: 'Eterna Bleach Bypass', dial: 'ETERNA BLEACH BYPASS', family: 'cine',
    blurb: 'Skipped bleach, silver retained. Gritty, metallic, high contrast.',
    character: ['gritty', 'dramatic', 'desaturated'],
    tone: [[0, 0], [0.1, 0.058], [0.25, 0.198], [0.5, 0.5], [0.75, 0.812], [0.9, 0.946], [1, 1]],
    channelMix: 0.2, sat: 0.46,
    hue: [[29, 0, 0.9, -0.01], [60, 0, 0.9, 0], [110, 0, 0.8, 0], [142, 4, 0.8, 0], [195, 0, 0.9, 0], [264, -6, 0.9, -0.01], [328, 0, 0.85, 0]],
    splitShadow: [-0.004, -0.008], splitHighlight: [0.001, 0.004],
  },
  {
    id: 'acros', name: 'Acros', dial: 'ACROS', family: 'mono',
    blurb: 'Fine-grain black & white with deep blacks and silky gradation.',
    character: ['b&w', 'fine grain', 'rich blacks'],
    tone: [[0, 0], [0.1, 0.072], [0.25, 0.218], [0.5, 0.5], [0.75, 0.788], [0.9, 0.928], [1, 1]],
    channelMix: 0, sat: 0, hue: neutralHue,
    splitShadow: [0, 0], splitHighlight: [0, 0],
    mono: { weights: MONO_WEIGHTS }, grainBias: 1,
  },
  {
    id: 'mono', name: 'Monochrome', dial: 'MONOCHROME', family: 'mono',
    blurb: 'Straight black & white. Neutral, even-handed tonality.',
    character: ['b&w', 'neutral', 'classic'],
    tone: [[0, 0], [0.1, 0.086], [0.25, 0.234], [0.5, 0.506], [0.75, 0.776], [0.9, 0.914], [1, 1]],
    channelMix: 0, sat: 0, hue: neutralHue,
    splitShadow: [0, 0], splitHighlight: [0, 0],
    mono: { weights: MONO_WEIGHTS },
  },
  {
    id: 'sepia', name: 'Sepia', dial: 'SEPIA', family: 'mono',
    blurb: 'Warm toned monochrome, like an old album print.',
    character: ['toned', 'vintage', 'warm'],
    tone: [[0, 0.02], [0.1, 0.1], [0.25, 0.248], [0.5, 0.5], [0.75, 0.764], [0.9, 0.9], [1, 0.98]],
    channelMix: 0, sat: 0, hue: neutralHue,
    splitShadow: [0, 0], splitHighlight: [0, 0],
    mono: { weights: MONO_WEIGHTS, tint: [0.018, 0.05] },
  },
];

export const SIM_BY_ID: Record<SimId, SimDef> = Object.fromEntries(SIMS.map((s) => [s.id, s])) as Record<SimId, SimDef>;
