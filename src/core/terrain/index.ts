import type { Prng } from '../prng';
import { centeredGridExtent, type GeoFrame, type GridExtent } from '../geo';
import { fbm, makeNoise2D } from './noise';
import { distanceToPolyline, generateRiver, type RiverPath, type RiverSide } from './river';

export type { RiverPath, RiverSide };

export type WaterKind = 'none' | 'river' | 'shore';

export interface TerrainConfig {
  cols: number;
  rows: number;
  cellSize: number;
  water: WaterKind;
}

export interface TerrainData {
  config: TerrainConfig;
  extent: GridExtent;
  /** Row-major Float32Array of elevation in meters; idx = row * cols + col. */
  heights: Float32Array;
  /** 1 where the cell is water (river surface or sea), 0 otherwise. */
  waterMask: Uint8Array;
  /** The water-line polyline (river center or shore), or null when water is 'none'. */
  river: RiverPath | null;
  minHeight: number;
  maxHeight: number;
  /** Elevation datum considered the water surface (river or sea). */
  seaLevel: number;
}

const SEA_LEVEL = 10;
const RIVER_BED = 2;
const VALLEY_HALF_WIDTH = 200;
const BLUFF_RANGE = 250;

const MACRO_OCTAVES = 2;
const MACRO_WAVELENGTH = 3000;
const MACRO_AMPLITUDE = 25;
const MACRO_BIAS = 30;

const TEXTURE_OCTAVES = 3;
const TEXTURE_WAVELENGTH = 100;
const TEXTURE_AMPLITUDE = 2;

const SHORE_WATER_HEIGHT = -2;

export function generateTerrain(rootPrng: Prng, frame: GeoFrame, config: TerrainConfig): TerrainData {
  const { cols, rows, cellSize, water } = config;
  const extent = centeredGridExtent(frame, cols, rows, cellSize);
  const heights = new Float32Array(cols * rows);
  const waterMask = new Uint8Array(cols * rows);

  const macroNoise = makeNoise2D(rootPrng.substream('terrain.macro'));
  const textureNoise = makeNoise2D(rootPrng.substream('terrain.texture'));
  const riverPrng = rootPrng.substream('terrain.river');
  const bluffPrng = rootPrng.substream('terrain.bluff');

  for (let row = 0; row < rows; row++) {
    const n = extent.minN + (row + 0.5) * cellSize;
    for (let col = 0; col < cols; col++) {
      const e = extent.minE + (col + 0.5) * cellSize;
      const macro = fbm(macroNoise, e, n, MACRO_OCTAVES, MACRO_WAVELENGTH) * MACRO_AMPLITUDE;
      const texture = fbm(textureNoise, e, n, TEXTURE_OCTAVES, TEXTURE_WAVELENGTH) * TEXTURE_AMPLITUDE;
      heights[row * cols + col] = MACRO_BIAS + macro + texture;
    }
  }

  const river = water === 'none' ? null : generateRiver(riverPrng, extent);
  const bluffHeight = river && river.bluffSide !== null ? bluffPrng.range(15, 30) : 0;

  if (river !== null && water === 'river') {
    for (let row = 0; row < rows; row++) {
      const n = extent.minN + (row + 0.5) * cellSize;
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const e = extent.minE + (col + 0.5) * cellSize;
        const { dist, side } = distanceToPolyline(e, n, river.points);

        if (dist < VALLEY_HALF_WIDTH) {
          const t = dist / VALLEY_HALF_WIDTH;
          const eased = t * t * (3 - 2 * t);
          const current = heights[idx]!;
          const target = RIVER_BED + (current - RIVER_BED) * eased;
          if (target < current) heights[idx] = target;
        }

        if (river.bluffSide !== null && dist >= VALLEY_HALF_WIDTH && dist < VALLEY_HALF_WIDTH + BLUFF_RANGE) {
          const cellSide: RiverSide = side >= 0 ? 'left' : 'right';
          if (cellSide === river.bluffSide) {
            const d = (dist - VALLEY_HALF_WIDTH) / BLUFF_RANGE;
            const falloff = Math.sqrt(Math.max(0, 1 - d));
            heights[idx] = heights[idx]! + bluffHeight * falloff;
          }
        }

        if (heights[idx]! < SEA_LEVEL && dist < VALLEY_HALF_WIDTH) {
          waterMask[idx] = 1;
        }
      }
    }
  } else if (river !== null && water === 'shore') {
    // Shore: same polyline as river generation. The opposite of citySide is
    // entirely flooded (lake or ocean); the city side stays dry. If a bluff
    // happens to be present, it rises near the waterline; otherwise it's a
    // flat coast.
    const { citySide } = river;
    for (let row = 0; row < rows; row++) {
      const n = extent.minN + (row + 0.5) * cellSize;
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const e = extent.minE + (col + 0.5) * cellSize;
        const { dist, side } = distanceToPolyline(e, n, river.points);
        const cellSide: RiverSide = side >= 0 ? 'left' : 'right';
        if (cellSide !== citySide) {
          heights[idx] = SHORE_WATER_HEIGHT;
          waterMask[idx] = 1;
        } else if (river.bluffSide === citySide && dist < BLUFF_RANGE) {
          const d = dist / BLUFF_RANGE;
          const falloff = Math.sqrt(Math.max(0, 1 - d));
          heights[idx] = heights[idx]! + bluffHeight * falloff;
        }
      }
    }
  }

  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i]!;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }

  return {
    config,
    extent,
    heights,
    waterMask,
    river,
    minHeight: minH,
    maxHeight: maxH,
    seaLevel: SEA_LEVEL,
  };
}
