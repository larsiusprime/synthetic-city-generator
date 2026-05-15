import { describe, expect, it } from 'vitest';
import { centeredGridExtent, makeFrame } from '../geo';
import type { RiverPath } from '../terrain';
import { pickDowntownAnchor } from './downtown';
import { SECTION_METERS, SECTIONS_PER_TOWNSHIP, generateGhostGrid } from './grid';

const KANSAS_CITY = { lat: 39.0997, lon: -94.5786 };

describe('generateGhostGrid', () => {
  it('places the anchor exactly at a section corner', () => {
    const frame = makeFrame(KANSAS_CITY);
    const extent = centeredGridExtent(frame, 512, 512, 10);
    const grid = generateGhostGrid(frame, extent);
    expect(grid.origin.e).toBeCloseTo(frame.anchorE, 6);
    expect(grid.origin.n).toBeCloseTo(frame.anchorN, 6);
  });

  it('produces lines at integer-mile offsets from the anchor', () => {
    const frame = makeFrame(KANSAS_CITY);
    const extent = centeredGridExtent(frame, 512, 512, 10);
    const grid = generateGhostGrid(frame, extent);
    for (const line of grid.lines) {
      const offset =
        line.direction === 'meridian'
          ? line.a.e - frame.anchorE
          : line.a.n - frame.anchorN;
      const mileFraction = offset / SECTION_METERS;
      expect(Math.abs(mileFraction - Math.round(mileFraction))).toBeLessThan(1e-6);
    }
  });

  it('tags every sixth line as a township boundary', () => {
    const frame = makeFrame(KANSAS_CITY);
    // 12-mile-wide extent so we get at least one township line on each axis.
    const wideExtent = centeredGridExtent(frame, 2048, 2048, 10);
    const grid = generateGhostGrid(frame, wideExtent);
    for (const line of grid.lines) {
      const expected = line.index % SECTIONS_PER_TOWNSHIP === 0 ? 'township' : 'section';
      expect(line.tier).toBe(expected);
    }
    expect(grid.lines.some((l) => l.tier === 'township')).toBe(true);
  });

  it('is deterministic across calls', () => {
    const frame = makeFrame(KANSAS_CITY);
    const extent = centeredGridExtent(frame, 512, 512, 10);
    const a = generateGhostGrid(frame, extent);
    const b = generateGhostGrid(frame, extent);
    expect(a.lines.length).toBe(b.lines.length);
    for (let i = 0; i < a.lines.length; i++) {
      expect(a.lines[i]).toEqual(b.lines[i]);
    }
  });
});

describe('pickDowntownAnchor', () => {
  it('picks a river × section-line intersection for a river city', () => {
    const frame = makeFrame(KANSAS_CITY);
    const extent = centeredGridExtent(frame, 512, 512, 10);
    const grid = generateGhostGrid(frame, extent);

    // Synthetic east-west river running through the anchor's latitude.
    const river: RiverPath = {
      points: [
        { e: extent.minE, n: frame.anchorN + 100 },
        { e: extent.maxE, n: frame.anchorN + 100 },
      ],
      horizontal: true,
      bluffSide: null,
    };

    const downtown = pickDowntownAnchor(extent, grid, river);
    expect(downtown.reason).toBe('river-section-intersection');
    // Intersection sits on the river's latitude (anchorN + 100).
    expect(downtown.utm.n).toBeCloseTo(frame.anchorN + 100, 6);
    // And on one of the meridian lines (integer miles from anchor).
    const mileOffset = (downtown.utm.e - frame.anchorE) / SECTION_METERS;
    expect(Math.abs(mileOffset - Math.round(mileOffset))).toBeLessThan(1e-6);
  });

  it('falls back to the centroid section corner for a riverless city', () => {
    const frame = makeFrame(KANSAS_CITY);
    const extent = centeredGridExtent(frame, 512, 512, 10);
    const grid = generateGhostGrid(frame, extent);

    const downtown = pickDowntownAnchor(extent, grid, null);
    expect(downtown.reason).toBe('centroid-section-corner');
    const dE = (downtown.utm.e - frame.anchorE) / SECTION_METERS;
    const dN = (downtown.utm.n - frame.anchorN) / SECTION_METERS;
    expect(Math.abs(dE - Math.round(dE))).toBeLessThan(1e-6);
    expect(Math.abs(dN - Math.round(dN))).toBeLessThan(1e-6);
  });
});
