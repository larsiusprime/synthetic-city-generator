import { describe, expect, it } from 'vitest';
import { centeredGridExtent, makeFrame } from '../geo';
import type { RiverPath } from '../terrain';
import { pickDowntownAnchor } from './downtown';
import { SECTION_METERS, SECTIONS_PER_TOWNSHIP, generateGhostGrid } from './grid';
import { TOWNSITE_SIDE_METERS, buildTownsite } from './townsite';
import { STREET_GRID_DIVISIONS, buildStreets } from './streets';
import { buildBlocks } from './blocks';

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

describe('buildTownsite', () => {
  it('with bank=null, is centered on the downtown anchor', () => {
    const frame = makeFrame(KANSAS_CITY);
    const downtown = {
      utm: { e: frame.anchorE + 100, n: frame.anchorN - 200 },
      reason: 'centroid-section-corner' as const,
    };
    const t = buildTownsite(downtown, null);
    expect(t.sideMeters).toBeCloseTo(TOWNSITE_SIDE_METERS, 6);
    expect(t.center).toEqual(downtown.utm);
    expect(t.bank).toBeNull();
  });

  it('with bank=north, shifts the townsite so the anchor sits at the south edge midpoint', () => {
    const frame = makeFrame(KANSAS_CITY);
    const downtown = {
      utm: { e: frame.anchorE, n: frame.anchorN },
      reason: 'river-section-intersection' as const,
    };
    const t = buildTownsite(downtown, 'north');
    const half = TOWNSITE_SIDE_METERS / 2;
    expect(t.center.e).toBeCloseTo(downtown.utm.e, 6);
    expect(t.center.n).toBeCloseTo(downtown.utm.n + half, 6);
    // Anchor lies on the south edge of the townsite.
    expect(t.sw.n).toBeCloseTo(downtown.utm.n, 6);
    expect(t.se.n).toBeCloseTo(downtown.utm.n, 6);
  });
});

describe('buildStreets', () => {
  const frame = makeFrame(KANSAS_CITY);
  const anchor = { utm: { e: frame.anchorE, n: frame.anchorN }, reason: 'centroid-section-corner' as const };

  it('produces a (divisions+1) x (divisions+1) grid', () => {
    const t = buildTownsite(anchor, null);
    const grid = buildStreets(t, anchor, true);
    expect(grid.divisions).toBe(STREET_GRID_DIVISIONS);
    expect(grid.streets).toHaveLength(2 * (STREET_GRID_DIVISIONS + 1));
    expect(grid.streets.filter((s) => s.axis === 'parallel')).toHaveLength(STREET_GRID_DIVISIONS + 1);
    expect(grid.streets.filter((s) => s.axis === 'meridian')).toHaveLength(STREET_GRID_DIVISIONS + 1);
  });

  it('riverless: Main Street and First Avenue at center; other lines from chosen schemes', () => {
    const t = buildTownsite(anchor, null);
    const grid = buildStreets(t, anchor, true); // streets numbered, avenues produce
    const center = STREET_GRID_DIVISIONS / 2;
    const main = grid.streets.find((s) => s.axis === 'parallel' && s.index === center)!;
    const first = grid.streets.find((s) => s.axis === 'meridian' && s.index === center)!;
    expect(main.name).toBe('Main Street');
    expect(first.name).toBe('First Avenue');
    const nonTrunkStreet = grid.streets.find((s) => s.axis === 'parallel' && s.index === 0)!;
    expect(nonTrunkStreet.name).toMatch(/^1st Street$/);
    const nonTrunkAvenue = grid.streets.find((s) => s.axis === 'meridian' && s.index === 0)!;
    expect(nonTrunkAvenue.name).toMatch(/Avenue$/);
    expect(nonTrunkAvenue.name).not.toMatch(/^\d/);
  });

  it('river north-bank: Front Street at riverfront, Main Avenue through anchor', () => {
    const t = buildTownsite(anchor, 'north');
    const grid = buildStreets(t, anchor, true);
    const front = grid.streets.find((s) => s.axis === 'parallel' && s.index === 0)!;
    const main = grid.streets.find((s) => s.axis === 'meridian' && s.index === STREET_GRID_DIVISIONS / 2)!;
    expect(front.name).toBe('Front Street');
    expect(main.name).toBe('Main Avenue');
    // Front Street runs along anchor's N (the riverfront).
    expect(front.a.n).toBeCloseTo(anchor.utm.n, 6);
    expect(front.b.n).toBeCloseTo(anchor.utm.n, 6);
  });

  it('flipping the naming coin swaps which axis is numbered vs produce', () => {
    const t = buildTownsite(anchor, null);
    const a = buildStreets(t, anchor, true);
    const b = buildStreets(t, anchor, false);
    expect(a.streetsScheme).not.toBe(b.streetsScheme);
    expect(a.avenuesScheme).not.toBe(b.avenuesScheme);
  });
});

describe('buildBlocks', () => {
  const frame = makeFrame(KANSAS_CITY);

  it('produces divisions^2 rectangular blocks tiling the townsite', () => {
    const anchor = { utm: { e: frame.anchorE, n: frame.anchorN }, reason: 'centroid-section-corner' as const };
    const t = buildTownsite(anchor, null);
    const blocks = buildBlocks(t, anchor);
    expect(blocks).toHaveLength(STREET_GRID_DIVISIONS * STREET_GRID_DIVISIONS);
    for (const b of blocks) {
      expect(b.ne.e - b.sw.e).toBeCloseTo(TOWNSITE_SIDE_METERS / STREET_GRID_DIVISIONS, 6);
      expect(b.ne.n - b.sw.n).toBeCloseTo(TOWNSITE_SIDE_METERS / STREET_GRID_DIVISIONS, 6);
    }
  });

  it('designates exactly one public square, nearest to the anchor (NE tiebreak)', () => {
    const anchor = { utm: { e: frame.anchorE, n: frame.anchorN }, reason: 'centroid-section-corner' as const };
    const t = buildTownsite(anchor, null);
    const blocks = buildBlocks(t, anchor);
    const squares = blocks.filter((b) => b.publicSquare);
    expect(squares).toHaveLength(1);
    // For riverless centered townsite, the NE of the four central blocks wins.
    expect(squares[0]!.col).toBe(STREET_GRID_DIVISIONS / 2);
    expect(squares[0]!.row).toBe(STREET_GRID_DIVISIONS / 2);
  });

  it('places the public square at the riverfront for a north-bank townsite', () => {
    const anchor = { utm: { e: frame.anchorE, n: frame.anchorN }, reason: 'river-section-intersection' as const };
    const t = buildTownsite(anchor, 'north');
    const blocks = buildBlocks(t, anchor);
    const square = blocks.find((b) => b.publicSquare)!;
    // For north-bank townsite (river to the south), the closest blocks to the
    // anchor are the southernmost (row=0). NE tiebreak picks col=DIVISIONS/2.
    expect(square.row).toBe(0);
    expect(square.col).toBe(STREET_GRID_DIVISIONS / 2);
  });
});
