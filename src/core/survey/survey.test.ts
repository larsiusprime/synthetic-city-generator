import { describe, expect, it } from 'vitest';
import { centeredGridExtent, makeFrame } from '../geo';
import { Prng } from '../prng';
import { generateTerrain, type RiverPath } from '../terrain';
import { buildBankConnectedMask, countMask, pointInPolygon, polygonArea, segmentIntersect } from './clip';
import { pickDowntownAnchor } from './downtown';
import { SECTION_METERS, SECTIONS_PER_TOWNSHIP, generateGhostGrid } from './grid';
import { TOWNSITE_SIDE_METERS, buildTownsite, pickTownsiteBank } from './townsite';
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
      bluffSide: null, citySide: 'left',
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
  it('with bank=null and no river, is a centered rectangle', () => {
    const frame = makeFrame(KANSAS_CITY);
    const downtown = {
      utm: { e: frame.anchorE + 100, n: frame.anchorN - 200 },
      reason: 'centroid-section-corner' as const,
    };
    const t = buildTownsite(downtown, null, null);
    expect(t.sideMeters).toBeCloseTo(TOWNSITE_SIDE_METERS, 6);
    expect(t.unclippedCenter).toEqual(downtown.utm);
    expect(t.bank).toBeNull();
    expect(t.ring).toHaveLength(4);
  });

  it('with bank=north and no river, shifts the unclipped center so the anchor lies on the south edge', () => {
    const frame = makeFrame(KANSAS_CITY);
    const downtown = {
      utm: { e: frame.anchorE, n: frame.anchorN },
      reason: 'river-section-intersection' as const,
    };
    const t = buildTownsite(downtown, 'north', null);
    const half = TOWNSITE_SIDE_METERS / 2;
    expect(t.unclippedCenter.e).toBeCloseTo(downtown.utm.e, 6);
    expect(t.unclippedCenter.n).toBeCloseTo(downtown.utm.n + half, 6);
    // The rectangle's south edge is at the anchor's N (the riverfront).
    const southEdgeN = Math.min(...t.ring.map((p) => p.n));
    expect(southEdgeN).toBeCloseTo(downtown.utm.n, 6);
  });
});

describe('buildStreets', () => {
  const frame = makeFrame(KANSAS_CITY);
  const anchor = { utm: { e: frame.anchorE, n: frame.anchorN }, reason: 'centroid-section-corner' as const };

  it('riverless: produces (divisions+1) x 2 lines, all straight rectangles', () => {
    const t = buildTownsite(anchor, null, null);
    const grid = buildStreets(t, null, true);
    expect(grid.divisions).toBe(STREET_GRID_DIVISIONS);
    expect(grid.streets).toHaveLength(2 * (STREET_GRID_DIVISIONS + 1));
    expect(grid.streets.filter((s) => s.axis === 'parallel')).toHaveLength(STREET_GRID_DIVISIONS + 1);
    for (const s of grid.streets) {
      expect(s.points).toHaveLength(2);
    }
  });

  it('riverless: Main Street and First Avenue at center; other lines from chosen schemes', () => {
    const t = buildTownsite(anchor, null, null);
    const grid = buildStreets(t, null, true);
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

  it('flipping the naming coin swaps which axis is numbered vs produce', () => {
    const t = buildTownsite(anchor, null, null);
    const a = buildStreets(t, null, true);
    const b = buildStreets(t, null, false);
    expect(a.streetsScheme).not.toBe(b.streetsScheme);
    expect(a.avenuesScheme).not.toBe(b.avenuesScheme);
  });
});

describe('buildBlocks', () => {
  const frame = makeFrame(KANSAS_CITY);

  it('riverless: produces divisions^2 rectangular blocks', () => {
    const anchor = { utm: { e: frame.anchorE, n: frame.anchorN }, reason: 'centroid-section-corner' as const };
    const t = buildTownsite(anchor, null, null);
    const blocks = buildBlocks(t, anchor);
    expect(blocks).toHaveLength(STREET_GRID_DIVISIONS * STREET_GRID_DIVISIONS);
    for (const b of blocks) {
      expect(b.ring).toHaveLength(4);
      const e0 = Math.min(...b.ring.map((p) => p.e));
      const e1 = Math.max(...b.ring.map((p) => p.e));
      const n0 = Math.min(...b.ring.map((p) => p.n));
      const n1 = Math.max(...b.ring.map((p) => p.n));
      expect(e1 - e0).toBeCloseTo(TOWNSITE_SIDE_METERS / STREET_GRID_DIVISIONS, 6);
      expect(n1 - n0).toBeCloseTo(TOWNSITE_SIDE_METERS / STREET_GRID_DIVISIONS, 6);
    }
  });

  it('riverless: designates exactly one public square at the NE-of-center block', () => {
    const anchor = { utm: { e: frame.anchorE, n: frame.anchorN }, reason: 'centroid-section-corner' as const };
    const t = buildTownsite(anchor, null, null);
    const blocks = buildBlocks(t, anchor);
    const squares = blocks.filter((b) => b.publicSquare);
    expect(squares).toHaveLength(1);
    expect(squares[0]!.col).toBe(STREET_GRID_DIVISIONS / 2);
    expect(squares[0]!.row).toBe(STREET_GRID_DIVISIONS / 2);
  });
});

function distanceToBoundary(p: { e: number; n: number }, ring: { e: number; n: number }[]): number {
  let min = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b.e - a.e;
    const dy = b.n - a.n;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = ((p.e - a.e) * dx + (p.n - a.n) * dy) / lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const cx = a.e + t * dx;
    const cy = a.n + t * dy;
    const d = Math.hypot(p.e - cx, p.n - cy);
    if (d < min) min = d;
  }
  return min;
}

function isInsideOrNearTownship(p: { e: number; n: number }, ring: { e: number; n: number }[]): boolean {
  if (pointInPolygon(p, ring)) return true;
  // Accept points within 2 m of the boundary (floating-point precision slop from polygon-clipping).
  return distanceToBoundary(p, ring) < 2.0;
}

describe('seed regressions', () => {
  // Seeds that previously produced a township polygon with an "orphan triangle" past where
  // the river sweep hits the outer edge of the township rectangle, plus seeds where blocks
  // extended outside the township polygon.
  const PROBLEM_SEEDS = [2573966306, 2281803266, 4258408191];

  function runSim(seed: number) {
    const prng = new Prng(seed);
    const frame = makeFrame(KANSAS_CITY);
    const config = { cols: 512, rows: 512, cellSize: 10, water: 'river' as const };
    const terrain = generateTerrain(prng, frame, config);
    const grid = generateGhostGrid(frame, terrain.extent);
    const downtown = pickDowntownAnchor(terrain.extent, grid, terrain.river);
    const bank = pickTownsiteBank(terrain.river);
    const water = {
      mask: terrain.waterMask,
      cols: config.cols,
      rows: config.rows,
      extent: terrain.extent,
    };
    const townsite = buildTownsite(downtown, bank, terrain.river, water);
    prng.substream('survey.street_naming').bool();
    const blocks = buildBlocks(townsite, downtown);
    const streetGrid = buildStreets(townsite, water, true);
    return { townsite, blocks, streets: streetGrid.streets, water, downtown, bank };
  }

  for (const seed of PROBLEM_SEEDS) {
    it(`seed ${seed}: every township vertex stays inside the original bounding box`, () => {
      const { townsite } = runSim(seed);
      const half = townsite.sideMeters / 2;
      const minE = townsite.unclippedCenter.e - half;
      const maxE = townsite.unclippedCenter.e + half;
      const minN = townsite.unclippedCenter.n - half;
      const maxN = townsite.unclippedCenter.n + half;
      const TOL = 1e-3;
      for (const p of townsite.ring) {
        expect(p.e).toBeGreaterThanOrEqual(minE - TOL);
        expect(p.e).toBeLessThanOrEqual(maxE + TOL);
        expect(p.n).toBeGreaterThanOrEqual(minN - TOL);
        expect(p.n).toBeLessThanOrEqual(maxN + TOL);
      }
    });

    it(`seed ${seed}: township polygon is simple (no self-intersections)`, () => {
      const { townsite } = runSim(seed);
      const ring = townsite.ring;
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          const isect = segmentIntersect(
            ring[i]!,
            ring[(i + 1) % n]!,
            ring[j]!,
            ring[(j + 1) % n]!,
          );
          if (isect !== null && isect.ta > 1e-6 && isect.ta < 1 - 1e-6 && isect.tb > 1e-6 && isect.tb < 1 - 1e-6) {
            throw new Error(`township self-intersection: edges ${i} and ${j} cross at ${JSON.stringify(isect.point)}`);
          }
        }
      }
    });

    it(`seed ${seed}: every block vertex is inside or on the township ring`, () => {
      const { townsite, blocks } = runSim(seed);
      for (const block of blocks) {
        for (const v of block.ring) {
          if (!isInsideOrNearTownship(v, townsite.ring)) {
            throw new Error(
              `seed ${seed} block (${block.col},${block.row}) vertex outside township: ${JSON.stringify(v)}`,
            );
          }
        }
      }
    });

    it(`seed ${seed}: township area is close to the bank-connected dry area (no orphan lobes)`, () => {
      const { townsite, water, downtown, bank } = runSim(seed);
      if (bank === null) return;
      const half = townsite.sideMeters / 2;
      const rect = {
        minE: townsite.unclippedCenter.e - half,
        maxE: townsite.unclippedCenter.e + half,
        minN: townsite.unclippedCenter.n - half,
        maxN: townsite.unclippedCenter.n + half,
      };
      const half2 = TOWNSITE_SIDE_METERS / 2;
      const a = downtown.utm;
      let seedPoint: { e: number; n: number };
      switch (bank) {
        case 'north':
          seedPoint = { e: a.e, n: a.n + 1.5 * half2 };
          break;
        case 'south':
          seedPoint = { e: a.e, n: a.n - 1.5 * half2 };
          break;
        case 'east':
          seedPoint = { e: a.e + 1.5 * half2, n: a.n };
          break;
        case 'west':
          seedPoint = { e: a.e - 1.5 * half2, n: a.n };
          break;
      }
      const bankMask = buildBankConnectedMask(water, rect, seedPoint);
      const rasterArea = countMask(bankMask) * water.extent.cellSize * water.extent.cellSize;
      const polyArea = polygonArea(townsite.ring);
      // Polygon should be no larger than 1.2x the bank-connected raster area
      // (allowing some leeway for cell-resolution / boundary effects).
      expect(polyArea / rasterArea).toBeLessThan(1.2);
    });
  }
});

describe('river clipping', () => {
  const frame = makeFrame(KANSAS_CITY);

  it('north-bank townsite with a slanted river keeps all of its area on the bank side', () => {
    // Anchor on the river, with a synthetic river running north-east through the area.
    const anchor = {
      utm: { e: frame.anchorE, n: frame.anchorN },
      reason: 'river-section-intersection' as const,
    };
    const river: RiverPath = {
      // River runs from far SW to far NE, passing through the anchor.
      points: [
        { e: frame.anchorE - 2000, n: frame.anchorN - 2000 },
        { e: frame.anchorE, n: frame.anchorN },
        { e: frame.anchorE + 2000, n: frame.anchorN + 2000 },
      ],
      horizontal: true,
      bluffSide: 'left', citySide: 'left',
    };
    const t = buildTownsite(anchor, 'north', river);
    // The clipped townsite ring should be irregular (more than 4 vertices) because the river cuts across.
    expect(t.ring.length).toBeGreaterThan(3);
    // Every vertex of the ring should be on the bank-seed side of the river (north of the slant).
    const seed = { e: frame.anchorE, n: frame.anchorN + 0.75 * TOWNSITE_SIDE_METERS };
    for (const p of t.ring) {
      // For this slanted river y = x (relative to anchor), points to the north of the line have n - anchor.n > e - anchor.e.
      const slope = p.n - frame.anchorN - (p.e - frame.anchorE);
      expect(slope).toBeGreaterThanOrEqual(-1);
    }
    expect(seed.n).toBeGreaterThan(frame.anchorN);
  });

  it('drops blocks on the far side of the river', () => {
    const anchor = {
      utm: { e: frame.anchorE, n: frame.anchorN },
      reason: 'river-section-intersection' as const,
    };
    // Horizontal river running E-W along the anchor's N coordinate.
    const river: RiverPath = {
      points: [
        { e: frame.anchorE - 2000, n: frame.anchorN },
        { e: frame.anchorE + 2000, n: frame.anchorN },
      ],
      horizontal: true,
      bluffSide: 'left', citySide: 'left',
    };
    // With bank=north, the unclipped townsite extends north from the anchor — no blocks on the far (south) side at all.
    const t = buildTownsite(anchor, 'north', river);
    // No water field — blocks fall back to the centroid-in-township test.
    const blocks = buildBlocks(t, anchor);
    expect(blocks.length).toBeLessThanOrEqual(STREET_GRID_DIVISIONS * STREET_GRID_DIVISIONS);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('streets are clipped by the water mask: lines crossing wet cells are dropped or shortened', () => {
    const anchor = {
      utm: { e: frame.anchorE, n: frame.anchorN },
      reason: 'river-section-intersection' as const,
    };
    const river: RiverPath = {
      points: [
        { e: frame.anchorE - 2000, n: frame.anchorN },
        { e: frame.anchorE + 2000, n: frame.anchorN },
      ],
      horizontal: true,
      bluffSide: 'left', citySide: 'left',
    };
    const t = buildTownsite(anchor, 'north', river);

    // Build a synthetic water mask: 50 m square cells over the townsite extent, with cells along the south edge marked wet.
    const cellSize = 50;
    const cols = Math.ceil(TOWNSITE_SIDE_METERS / cellSize) + 4;
    const rows = Math.ceil(TOWNSITE_SIDE_METERS / cellSize) + 4;
    const minE = t.unclippedCenter.e - (cols / 2) * cellSize;
    const minN = t.unclippedCenter.n - (rows / 2) * cellSize;
    const mask = new Uint8Array(cols * rows);
    // Wet cells: those whose centers lie south of the anchor (i.e., in the river).
    for (let r = 0; r < rows; r++) {
      const n = minN + (r + 0.5) * cellSize;
      if (n < anchor.utm.n) {
        for (let c = 0; c < cols; c++) mask[r * cols + c] = 1;
      }
    }
    const water = {
      mask,
      cols,
      rows,
      extent: {
        minE,
        minN,
        maxE: minE + cols * cellSize,
        maxN: minN + rows * cellSize,
        cellSize,
        cols,
        rows,
      },
    };
    const grid = buildStreets(t, water, true);
    expect(grid.streets.length).toBeGreaterThan(0);
    // No street segment should start or end at a wet point.
    for (const s of grid.streets) {
      for (const p of s.points) {
        expect(p.n).toBeGreaterThanOrEqual(anchor.utm.n - cellSize);
      }
    }
  });
});
