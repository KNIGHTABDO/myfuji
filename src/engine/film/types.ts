export type SimId =
  | 'provia'
  | 'velvia'
  | 'astia'
  | 'classic-chrome'
  | 'reala-ace'
  | 'pro-neg-hi'
  | 'pro-neg-std'
  | 'classic-neg'
  | 'nostalgic-neg'
  | 'eterna'
  | 'eterna-bb'
  | 'acros'
  | 'mono'
  | 'sepia';

export type MonoFilter = 'std' | 'ye' | 'r' | 'g';
export type Strength = 'off' | 'weak' | 'strong';
export type WbMode = 'as-shot' | 'auto' | 'auto-white' | 'auto-ambience' | 'shade' | 'incandescent' | 'fluorescent' | 'kelvin';
export type DrMode = 'auto' | 100 | 200 | 400;
export type CropId = 'original' | '3:2' | '4:3' | '4:5' | '1:1' | '16:9' | '65:24';

export interface DevelopParams {
  sim: SimId;
  /** 0..1 blend between the untouched pre-film image and the film simulation. */
  intensity: number;
  monoFilter: MonoFilter;
  /** Monochromatic colour, Fuji style: warm(+)/cool(-) and magenta(+)/green(-), -9..9. */
  monoWC: number;
  monoMG: number;
  wbMode: WbMode;
  wbKelvin: number;
  wbShiftR: number;
  wbShiftB: number;
  exposure: number;
  dr: DrMode;
  highlight: number;
  shadow: number;
  color: number;
  sharpness: number;
  clarity: number;
  grain: Strength;
  grainSize: 'small' | 'large';
  cce: Strength;
  cceBlue: Strength;
  /** 0..1 local tone mapping (adaptive dynamic range). */
  smartLight: number;
  /** 0..1 lift for faces/subjects that sit darker than the scene. */
  subjectLift: number;
  skinProtect: boolean;
  vignette: number;
  halation: number;
  fade: number;
  lightLeak: number;
  leakSeed: number;
  crop: CropId;
  /** Normalised crop centre chosen by the smart-crop (faces/subjects). */
  cropCenter: [number, number];
}

export const DEFAULT_PARAMS: DevelopParams = {
  sim: 'provia',
  intensity: 1,
  monoFilter: 'ye',
  monoWC: 0,
  monoMG: 0,
  wbMode: 'auto',
  wbKelvin: 5500,
  wbShiftR: 0,
  wbShiftB: 0,
  exposure: 0,
  dr: 'auto',
  highlight: 0,
  shadow: 0,
  color: 0,
  sharpness: 0,
  clarity: 0,
  grain: 'off',
  grainSize: 'small',
  cce: 'off',
  cceBlue: 'off',
  smartLight: 0.5,
  subjectLift: 0.5,
  skinProtect: true,
  vignette: 0,
  halation: 0,
  fade: 0,
  lightLeak: 0,
  leakSeed: 7,
  crop: 'original',
  cropCenter: [0.5, 0.5],
};
