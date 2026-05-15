import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import type { Prng } from '../prng';

export function makeNoise2D(prng: Prng): NoiseFunction2D {
  return createNoise2D(() => prng.float());
}

/**
 * Fractional Brownian motion: sum of `octaves` noise samples at decreasing
 * wavelengths and amplitudes. Returns a value roughly in [-1, 1] (not strictly
 * bounded; depends on octaves/persistence).
 */
export function fbm(
  noise: NoiseFunction2D,
  x: number,
  y: number,
  octaves: number,
  wavelength: number,
  persistence: number = 0.5,
  lacunarity: number = 2,
): number {
  let value = 0;
  let amp = 1;
  let freq = 1 / wavelength;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    value += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return norm === 0 ? 0 : value / norm;
}
