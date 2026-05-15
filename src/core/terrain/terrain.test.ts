import { describe, expect, it } from 'vitest';
import { makeFrame } from '../geo';
import { Prng } from '../prng';
import { generateTerrain } from './index';

const KANSAS_CITY = { lat: 39.0997, lon: -94.5786 };

describe('generateTerrain', () => {
  it('produces identical heightmaps from the same seed', () => {
    const frame = makeFrame(KANSAS_CITY);
    const config = { cols: 64, rows: 64, cellSize: 10, includeRiver: true };

    const a = generateTerrain(new Prng(99), frame, config);
    const b = generateTerrain(new Prng(99), frame, config);

    expect(a.heights.length).toBe(b.heights.length);
    for (let i = 0; i < a.heights.length; i++) {
      expect(a.heights[i]).toBe(b.heights[i]);
    }
    expect(a.minHeight).toBe(b.minHeight);
    expect(a.maxHeight).toBe(b.maxHeight);
    expect(a.river?.points.length).toBe(b.river?.points.length);
  });

  it('produces different heightmaps from different seeds', () => {
    const frame = makeFrame(KANSAS_CITY);
    const config = { cols: 64, rows: 64, cellSize: 10, includeRiver: true };

    const a = generateTerrain(new Prng(1), frame, config);
    const b = generateTerrain(new Prng(2), frame, config);

    let differ = 0;
    for (let i = 0; i < a.heights.length; i++) {
      if (a.heights[i] !== b.heights[i]) differ++;
    }
    expect(differ).toBeGreaterThan(a.heights.length / 2);
  });

  it('omits river when includeRiver is false', () => {
    const frame = makeFrame(KANSAS_CITY);
    const config = { cols: 64, rows: 64, cellSize: 10, includeRiver: false };
    const t = generateTerrain(new Prng(7), frame, config);

    expect(t.river).toBeNull();
    let waterCells = 0;
    for (let i = 0; i < t.waterMask.length; i++) {
      if (t.waterMask[i] === 1) waterCells++;
    }
    expect(waterCells).toBe(0);
  });

  it('produces water cells when river is enabled', () => {
    const frame = makeFrame(KANSAS_CITY);
    const config = { cols: 128, rows: 128, cellSize: 10, includeRiver: true };
    const t = generateTerrain(new Prng(7), frame, config);

    let waterCells = 0;
    for (let i = 0; i < t.waterMask.length; i++) {
      if (t.waterMask[i] === 1) waterCells++;
    }
    expect(waterCells).toBeGreaterThan(0);
  });

  it('elevations are finite and within reasonable bounds', () => {
    const frame = makeFrame(KANSAS_CITY);
    const config = { cols: 64, rows: 64, cellSize: 10, includeRiver: true };
    const t = generateTerrain(new Prng(99), frame, config);
    for (let i = 0; i < t.heights.length; i++) {
      expect(Number.isFinite(t.heights[i]!)).toBe(true);
    }
    expect(t.minHeight).toBeGreaterThan(-50);
    expect(t.maxHeight).toBeLessThan(200);
  });
});
