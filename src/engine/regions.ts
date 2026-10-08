// Region maps for region-aware grading. Computed once per photo at analysis
// resolution (the WorkImage grid, ≤768 px) and uploaded as a second RGBA16F
// texture (uRegions) sampled with linear filtering.
import type { WorkImage } from './aux';

export interface RegionMaps {
  w: number;
  h: number;
  /** open sky / bright see-through gaps in canopy (0..1) */
  sky: Float32Array;
  /** vegetation: leaves, grass, plants (0..1) */
  foliage: Float32Array;
  /** ground plane: roads, paths, sand, soil, floors (0..1) */
  ground: Float32Array;
  /** directly sunlit / key-lit amount relative to the local surroundings (0 = shade, 1 = full sun) */
  sun: Float32Array;
}

/** STUB — replaced by the real implementation. Inputs: the analysis image and the person mask (same grid, may be null). */
export function computeRegions(img: WorkImage, person: Float32Array | null): RegionMaps {
  const n = img.w * img.h;
  void person;
  return { w: img.w, h: img.h, sky: new Float32Array(n), foliage: new Float32Array(n), ground: new Float32Array(n), sun: new Float32Array(n) };
}
