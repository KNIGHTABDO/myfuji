import type { WorkImage } from '../aux';
import { timeOfDay, type ExifInfo, type TimeOfDay } from '../exif';
import type { Stats } from './stats';
import type { VisionResult } from './vision';

export type Subject =
  | 'portrait' | 'group' | 'people' | 'street' | 'landscape' | 'architecture' | 'food' | 'animal'
  | 'nature' | 'night-city' | 'interior' | 'vehicle' | 'beach' | 'snow' | 'still-life' | 'general';
export type Lighting =
  | 'golden-hour' | 'blue-hour' | 'night' | 'tungsten' | 'fluorescent' | 'overcast' | 'harsh-sun'
  | 'daylight' | 'backlit' | 'low-key' | 'high-key' | 'neon';

export interface Scene {
  subject: Subject;
  subjectScores: Array<[Subject, number]>;
  lighting: Lighting;
  lightingScores: Array<[Lighting, number]>;
  time: TimeOfDay & { inferred: TimeOfDay['phase'] | 'indoor' };
  facts: string[];
  story: string;
  faceLum: number | null;
  backgroundLum: number;
  /** stops the subject sits below where it should */
  subjectDeficit: number;
  saliency: [number, number];
}

const LABELS: Record<string, string[]> = {
  landscape: ['alp', 'valley', 'volcano', 'cliff', 'promontory', 'lakeside', 'seashore', 'sandbar', 'geyser', 'breakwater', 'dam', 'mountain', 'coral reef', 'fjord', 'canyon'],
  beach: ['seashore', 'sandbar', 'beach', 'swimming trunks', 'bikini', 'sunscreen', 'surf'],
  snow: ['alp', 'ski', 'snowmobile', 'dogsled', 'snowplow', 'igloo'],
  food: ['pizza', 'cheeseburger', 'hotdog', 'hot dog', 'ice cream', 'espresso', 'plate', 'carbonara', 'guacamole', 'consomme', 'trifle', 'bagel', 'pretzel', 'burrito', 'potpie', 'meat loaf', 'chocolate sauce', 'dough', 'french loaf', 'mashed potato', 'cabbage', 'broccoli', 'cauliflower', 'zucchini', 'cucumber', 'bell pepper', 'granny smith', 'strawberry', 'orange', 'lemon', 'fig', 'pineapple', 'banana', 'pomegranate', 'red wine', 'eggnog', 'menu', 'wok', 'frying pan', 'dutch oven', 'soup bowl', 'mixing bowl', 'tray', 'coffee mug', 'teapot', 'wine bottle', 'beer glass', 'goblet', 'cup', 'waffle iron', 'spaghetti', 'sushi', 'custard', 'mushroom'],
  architecture: ['church', 'mosque', 'palace', 'monastery', 'castle', 'dome', 'bell cote', 'triumphal arch', 'library', 'planetarium', 'stupa', 'obelisk', 'prison', 'tile roof', 'vault', 'altar', 'suspension bridge', 'steel arch bridge', 'viaduct', 'pier', 'boathouse', 'barn', 'greenhouse', 'cinema', 'fountain', 'water tower', 'beacon', 'column', 'bannister', 'balustrade', 'skyscraper', 'thatch', 'lakeside'],
  street: ['street sign', 'traffic light', 'parking meter', 'streetcar', 'trolleybus', 'cab', 'police van', 'minibus', 'passenger car', 'moped', 'motor scooter', 'garbage truck', 'fire engine', 'tricycle', 'shopping cart', 'barbershop', 'bakery', 'bookshop', 'butcher shop', 'confectionery', 'shoe shop', 'tobacco shop', 'toyshop', 'grocery store', 'restaurant', 'umbrella', 'manhole'],
  vehicle: ['sports car', 'convertible', 'racer', 'jeep', 'limousine', 'minivan', 'pickup', 'car wheel', 'grille', 'airliner', 'warplane', 'speedboat', 'yawl', 'schooner', 'catamaran', 'liner', 'container ship', 'locomotive', 'bullet train', 'motor scooter', 'moped', 'beach wagon', 'station wagon'],
  nature: ['daisy', 'slipper', 'bee', 'ant', 'butterfly', 'admiral', 'monarch', 'cabbage butterfly', 'sulphur butterfly', 'lycaenid', 'ringlet', 'leaf beetle', 'ladybug', 'dragonfly', 'damselfly', 'hip', 'buckeye', 'acorn', 'coral fungus', 'agaric', 'gyromitra', 'earthstar', 'hen-of-the-woods', 'bolete', 'rapeseed', 'corn', 'ear', 'pot', 'vase', 'cardoon', 'spider', 'snail'],
  interior: ['studio couch', 'dining table', 'bookcase', 'wardrobe', 'desk', 'four-poster', 'quilt', 'window shade', 'lampshade', 'table lamp', 'home theater', 'entertainment center', 'rocking chair', 'folding chair', 'shower curtain', 'tub', 'washbasin', 'medicine chest', 'refrigerator', 'microwave', 'stove', 'dishwasher', 'wall clock', 'bookshop', 'library', 'restaurant', 'sliding door', 'window screen', 'china cabinet', 'chiffonier', 'cradle', 'crib'],
  stillLife: ['vase', 'pot', 'candle', 'perfume', 'lotion', 'hourglass', 'teapot', 'coffee mug', 'bottle', 'jug', 'pitcher', 'book jacket', 'notebook', 'laptop', 'camera', 'reflex camera', 'watch', 'sunglasses'],
  neon: ['scoreboard', 'slot', 'theater curtain', 'stage', 'cinema'],
};
const COCO_FOOD = ['banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'bowl', 'cup', 'wine glass', 'fork', 'knife', 'spoon'];
const COCO_ANIMAL = ['cat', 'dog', 'bird', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe'];
const COCO_STREET = ['car', 'bus', 'truck', 'traffic light', 'stop sign', 'bicycle', 'motorcycle', 'parking meter', 'bench', 'fire hydrant'];
const COCO_INDOOR = ['couch', 'bed', 'dining table', 'tv', 'laptop', 'chair', 'potted plant', 'oven', 'refrigerator', 'sink', 'book', 'clock', 'vase'];

function regionLum(img: WorkImage, x: number, y: number, w: number, h: number) {
  const x0 = Math.max(0, Math.floor(x * img.w)), y0 = Math.max(0, Math.floor(y * img.h));
  const x1 = Math.min(img.w, Math.ceil((x + w) * img.w)), y1 = Math.min(img.h, Math.ceil((y + h) * img.h));
  const vals: number[] = [];
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) vals.push(img.Y[yy * img.w + xx]);
  vals.sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length * 0.6)] : 0;
}

export function readScene(img: WorkImage, st: Stats, v: VisionResult, exif: ExifInfo): Scene {
  const labels = v.labels.filter((l) => l.score > 0.04).map((l) => l.name.toLowerCase());
  const labelScore = (words: string[]) => v.labels.reduce((s, l) => s + (words.some((w) => l.name.toLowerCase().includes(w)) ? l.score : 0), 0);
  const obj = (names: string[]) => v.objects.filter((o) => names.includes(o.name));
  const faceArea = v.faces.reduce((m, f) => Math.max(m, f.w * f.h), 0);
  const nFaces = v.faces.filter((f) => f.w * f.h > 0.0015).length;
  const person = v.segFractions['person'] ?? 0;
  const animalSeg = ['cat', 'dog', 'bird', 'horse', 'sheep', 'cow'].reduce((s, k) => s + (v.segFractions[k] ?? 0), 0);
  const people = obj(['person']).filter((o) => o.score > 0.45);
  const tod = timeOfDay(exif);

  // ---------- subject ----------
  const S: Partial<Record<Subject, number>> = {};
  const add = (k: Subject, x: number) => { S[k] = (S[k] ?? 0) + x; };
  if (faceArea > 0.012 || (person > 0.2 && nFaces >= 1)) add('portrait', 1.2 + Math.min(1, faceArea * 12));
  if (nFaces >= 3) add('group', 1.1 + nFaces * 0.08);
  if (people.length >= 1 && person < 0.2) add('people', 0.4 + people.length * 0.1);
  add('street', labelScore(LABELS.street) * 2 + obj(COCO_STREET).length * 0.18 + (people.length && person < 0.12 ? 0.35 : 0));
  add('landscape', labelScore(LABELS.landscape) * 2.2 + (st.sky.fraction > 0.3 ? 0.35 : 0) + (st.hueMass.green + st.hueMass.blue > 0.35 ? 0.25 : 0) - person * 2);
  add('architecture', labelScore(LABELS.architecture) * 2);
  add('food', labelScore(LABELS.food) * 2.2 + obj(COCO_FOOD).length * 0.22);
  add('animal', obj(COCO_ANIMAL).filter((o) => o.score > 0.5 && o.w * o.h > 0.01).reduce((s, o) => s + o.score, 0) * 0.9 + animalSeg * 3);
  add('nature', labelScore(LABELS.nature) * 2);
  add('interior', labelScore(LABELS.interior) * 1.6 + obj(COCO_INDOOR).length * 0.12);
  add('vehicle', labelScore(LABELS.vehicle) * 1.8);
  add('beach', labelScore(LABELS.beach) * 2);
  add('snow', labelScore(LABELS.snow) * 1.5 + (st.p.p50 > 0.45 && st.meanChroma < 0.03 ? 0.3 : 0));
  add('still-life', labelScore(LABELS.stillLife) * 1.5);
  const subjectScores = (Object.entries(S) as Array<[Subject, number]>).sort((a, b) => b[1] - a[1]);
  let subject: Subject = subjectScores[0] && subjectScores[0][1] > 0.35 ? subjectScores[0][0] : 'general';

  // ---------- light ----------
  const faceLums = v.faces.map((f) => regionLum(img, f.x + f.w * 0.2, f.y + f.h * 0.25, f.w * 0.6, f.h * 0.6));
  const faceLum = faceLums.length ? faceLums.reduce((a, b) => a + b, 0) / faceLums.length : null;
  const backgroundLum = st.p.p50;
  const L: Partial<Record<Lighting, number>> = {};
  const addL = (k: Lighting, x: number) => { L[k] = (L[k] ?? 0) + x; };
  const key = st.key;
  const warm = st.cct < 4300, veryWarm = st.cct < 3500, cool = st.cct > 7200;
  addL('night', (key < 0.03 && st.darkFrac > 0.3 ? 1.4 : key < 0.06 && st.darkFrac > 0.25 ? 0.6 : 0) + (st.sky.kind === 'night' ? 0.5 : 0) + Math.min(0.8, st.pointLights * 0.06) + (tod.phase === 'night' ? 0.9 : 0));
  addL('blue-hour', (st.sky.kind === 'dusk' ? 0.9 : 0) + (cool && key < 0.15 ? 0.5 : 0) + (tod.phase === 'blue-hour' ? 1 : 0));
  addL('golden-hour', (st.sky.kind === 'sunset' ? 1.1 : 0) + (warm && st.sky.kind !== 'none' ? 0.6 : 0) + (warm && key > 0.05 && st.hueMass.orange + st.hueMass.yellow > 0.25 ? 0.4 : 0) + (tod.phase === 'golden-hour' ? 0.9 : 0));
  addL('tungsten', (veryWarm && st.sky.kind === 'none' && st.wbReliability > 0.3 ? 1.0 : 0) + (warm && st.sky.kind === 'none' && key < 0.15 ? 0.4 : 0) + (S.interior ?? 0) * 0.3);
  addL('fluorescent', st.tint > 0.07 && st.wbReliability > 0.4 ? 0.8 + st.tint * 4 : 0);
  addL('overcast', (st.sky.kind === 'overcast' ? 1 : 0) + (st.contrast < 1.5 && st.cct > 5800 && key > 0.08 ? 0.5 : 0));
  addL('harsh-sun', (st.contrast > 2.2 && key > 0.1 ? 0.6 : 0) + (st.sky.kind === 'blue' ? 0.4 : 0) + (st.clipHigh > 0.02 ? 0.3 : 0) + (tod.phase === 'day' ? 0.2 : 0));
  addL('daylight', 0.55 + (st.sky.kind === 'blue' ? 0.3 : 0) + (tod.phase === 'day' ? 0.3 : 0));
  if (faceLum !== null && faceLum < backgroundLum * 0.6 && faceLum < 0.16) addL('backlit', 1.2 + Math.min(1, Math.log2(backgroundLum / Math.max(faceLum, 1e-4)) * 0.3));
  else if (st.topVsBottom > 1.6 && person > 0.08) addL('backlit', 0.8);
  if (st.p.p50 > 0.42 && st.p.p05 > 0.08) addL('high-key', 1.1);
  if (key < 0.06 && (L.night ?? 0) < 1.2) addL('low-key', 0.7 + (key < 0.035 ? 0.3 : 0));
  if (st.hueMass.magenta + st.hueMass.purple + st.hueMass.cyan > 0.12 && key < 0.08 && st.darkFrac > 0.25) addL('neon', 1.0 + labelScore(LABELS.neon));
  const lightingScores = (Object.entries(L) as Array<[Lighting, number]>).sort((a, b) => b[1] - a[1]);
  const lighting = lightingScores[0][0];
  if ((lighting === 'night' || lighting === 'neon') && (subject === 'street' || subject === 'general' || subject === 'architecture' || subject === 'vehicle')) subject = 'night-city';

  const inferred = tod.phase !== 'unknown' ? tod.phase
    : lighting === 'night' || lighting === 'neon' ? 'night'
    : lighting === 'blue-hour' ? 'blue-hour'
    : lighting === 'golden-hour' ? 'golden-hour'
    : lighting === 'tungsten' || lighting === 'fluorescent' || subject === 'interior' ? 'indoor' : 'day';

  // ---------- where the eye goes (for smart crops) ----------
  let sal: [number, number] = [0.5, 0.5];
  if (v.faces.length) {
    let sx = 0, sy = 0, sw = 0;
    for (const f of v.faces) { const w = f.w * f.h; sx += (f.x + f.w / 2) * w; sy += (f.y + f.h / 2) * w; sw += w; }
    sal = [sx / sw, sy / sw];
  } else if (v.objects.length) {
    const o = [...v.objects].sort((a, b) => b.score * b.w * b.h - a.score * a.w * a.h)[0];
    sal = [o.x + o.w / 2, o.y + o.h / 2];
  }

  // ---------- facts & story ----------
  const facts: string[] = [];
  if (nFaces) facts.push(`${nFaces} face${nFaces > 1 ? 's' : ''} found`);
  if (people.length && !nFaces) facts.push(`${people.length} ${people.length > 1 ? 'people' : 'person'} in frame`);
  const things = [...new Set(v.objects.filter((o) => o.name !== 'person' && o.score > 0.4).map((o) => o.name))].slice(0, 4);
  if (things.length) facts.push(`sees ${things.join(', ')}`);
  if (labels.length) facts.push(`looks like: ${labels.slice(0, 3).map((l) => l.split(',')[0]).join(' · ')}`);
  if (st.sky.kind !== 'none') facts.push(`${st.sky.kind === 'dusk' ? 'dusky' : st.sky.kind} sky across ${Math.round(st.sky.fraction * 100)}% of the top`);
  facts.push(`light ≈ ${Math.round(st.cct / 100) * 100} K${Math.abs(st.tint) > 0.05 ? (st.tint > 0 ? ', green cast' : ', magenta cast') : ''}`);
  facts.push(`${st.drStops.toFixed(1)} stops of scene range`);
  if (st.clipHigh > 0.01) facts.push(`${(st.clipHigh * 100).toFixed(1)}% blown highlights`);
  if (st.pointLights > 2) facts.push(`${st.pointLights} point lights`);
  if (faceLum !== null) facts.push(`faces sit ${Math.log2(Math.max(faceLum, 1e-4) / 0.3).toFixed(1)} EV from ideal`);

  const subjectWords: Record<Subject, string> = {
    portrait: 'a portrait', group: 'a group of people', people: 'people in a scene', street: 'a street scene', landscape: 'a landscape',
    architecture: 'architecture', food: 'food', animal: 'an animal', nature: 'a close look at nature', 'night-city': 'the city at night',
    interior: 'an interior', vehicle: 'a vehicle', beach: 'the seaside', snow: 'a snowy scene', 'still-life': 'a still life', general: 'an everyday moment',
  };
  const lightWords: Record<Lighting, string> = {
    'golden-hour': 'low, golden sun', 'blue-hour': 'the blue hour', night: 'night-time light', tungsten: 'warm tungsten light', fluorescent: 'greenish artificial light',
    overcast: 'soft overcast light', 'harsh-sun': 'hard midday sun', daylight: 'clean daylight', backlit: 'strong backlight', 'low-key': 'a dark, low-key mood',
    'high-key': 'a bright, high-key mood', neon: 'coloured neon light',
  };
  const palette = st.palette.slice(0, 3).map((p) => p.name).join(', ');
  const story = `This reads as ${subjectWords[subject]} in ${lightWords[lighting]}${tod.source === 'sun' ? ` (the sun was ${tod.sunElevation!.toFixed(0)}° ${tod.sunElevation! >= 0 ? 'above' : 'below'} the horizon)` : ''}. The palette leans ${palette}.`;

  const subjectDeficit = faceLum !== null ? Math.max(0, Math.log2(0.28 / Math.max(faceLum, 1e-4))) : 0;
  return { subject, subjectScores, lighting, lightingScores, time: { ...tod, inferred }, facts, story, faceLum, backgroundLum, subjectDeficit, saliency: sal };
}
