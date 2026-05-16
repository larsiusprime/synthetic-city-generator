import type { UtmCoord } from '../geo';
import type { RiverPath } from '../terrain';
import { type Block, type BlockKind, blockRect, fullInsetBlockArea } from './blocks';
import type { DowntownAnchor } from './downtown';
import type { Founder } from './founder';
import { intersectPolygons, ringCentroid } from './poly-ops';
import { STREET_GRID_DIVISIONS, type StreetGrid } from './streets';
import type { Townsite } from './townsite';

export type ParcelUse = 'residential' | 'commercial' | 'church' | 'school' | 'public-square';

export interface Parcel {
  id: number;
  blockCol: number;
  blockRow: number;
  /** 1-based lot number within the block (in plat order). For reserved blocks (square / school), always 1. */
  lotNumber: number;
  ring: UtmCoord[];
  areaSqM: number;
  use: ParcelUse;
  /** Name of the street the lot's front faces, or null for reserved blocks. */
  frontageStreet: string | null;
  ownerId: string;
}

export interface PlatResult {
  parcels: Parcel[];
  /** Blocks re-classified by use (kind set) and re-clipped to land. Drops blocks with no surviving parcels. */
  blocks: Block[];
}

const ALLEY_WIDTH_METERS = 5;
const COMMERCIAL_LOT_WIDTH_METERS = 7.62; // ~25 ft
const RESIDENTIAL_LOT_WIDTH_METERS = 15.24; // ~50 ft
const MAX_CHURCH_LOTS = 2;
/** Minimum absolute land area for a parcel (anything smaller is a useless sliver). */
const MIN_PARCEL_AREA_M2 = 50;
/** Minimum surviving fraction of the original plan rectangle area to keep a parcel. */
const MIN_LAND_FRACTION_KEEP = 0.5;
/** Minimum surviving fraction to be eligible for special-parcel roles (church). */
const MIN_LAND_FRACTION_FULL = 0.75;
/** Minimum surviving bbox dimension (E or N) as a fraction of the plan-rect dimension. */
const MIN_DIMENSION_RATIO = 0.35;
/** Surviving block area fraction required for a block to be eligible for public-square / school. */
const BLOCK_FULLNESS_THRESHOLD = 0.8;
/** Minimum block ring area (as fraction of full inset block area) for a block to host a church. */
const MIN_BLOCK_AREA_FOR_CHURCH = 0.75;

type AlleyAxis = 'east-west' | 'north-south';

function chooseAlleyAxis(river: RiverPath | null): AlleyAxis {
  if (river === null) return 'east-west';
  return river.horizontal ? 'east-west' : 'north-south';
}

/**
 * Builds the t=0 plat: subdivides every block at residential lot width,
 * applies the degeneracy filter (drop slivers by area + bbox-thinness vs
 * the original plan rectangle), classifies blocks by use based on which
 * basic parcels survived, then resolves special parcels:
 *   - public-square / school blocks collapse back to a single block-shaped parcel
 *   - commercial blocks are re-subdivided at the narrower commercial width
 *   - residential blocks keep their basic parcels
 *   - 1–2 corner lots of square-adjacent commercial blocks are tagged 'church'
 *
 * Water clipping is implicit: `block.ring` is already
 * `(block rect) ∩ townsite.ring`, and `townsite.ring` is water-clipped
 * against the bank-connected dry mask (then Douglas-Peucker simplified)
 * at townsite-build time. Clipping parcels against the block ring gives
 * cleaner edges than subtracting raw water polygons.
 *
 * Returns both the parcels and the re-classified blocks (blocks with no
 * surviving parcels are dropped entirely).
 */
export function buildParcels(
  townsite: Townsite,
  blocks: readonly Block[],
  streetGrid: StreetGrid,
  river: RiverPath | null,
  downtown: DowntownAnchor,
  founder: Founder,
): PlatResult {
  const alleyAxis = chooseAlleyAxis(river);

  // ── Phase 1: subdivide every block at residential width; degeneracy filter each basic parcel.
  interface BasicParcel {
    blockCol: number;
    blockRow: number;
    lotNumber: number;
    ring: UtmCoord[];
    landArea: number;
    /** landArea / area(plan rectangle) — used downstream to gate special-parcel roles. */
    landFraction: number;
    frontageStreet: string | null;
  }
  const basicByBlock = new Map<string, BasicParcel[]>();
  const survivedAreaByBlock = new Map<string, number>();
  for (const block of blocks) {
    const rect = blockRect(townsite, block.col, block.row);
    const plans = layoutLots(rect, alleyAxis, RESIDENTIAL_LOT_WIDTH_METERS, block, streetGrid);
    const survived: BasicParcel[] = [];
    let blockArea = 0;
    for (const plan of plans) {
      const result = clipPlanToBlock(plan.ring, block.ring);
      if (result === null) continue;
      survived.push({
        blockCol: block.col,
        blockRow: block.row,
        lotNumber: plan.lotNumber,
        ring: result.ring,
        landArea: result.landArea,
        landFraction: result.landFraction,
        frontageStreet: plan.frontageStreet,
      });
      blockArea += result.landArea;
    }
    const key = blockKey(block.col, block.row);
    if (survived.length > 0) {
      basicByBlock.set(key, survived);
      survivedAreaByBlock.set(key, blockArea);
    }
  }

  // ── Phase 2: classify blocks based on survived-area.
  const fullArea = fullInsetBlockArea(townsite);
  const fullnessThreshold = BLOCK_FULLNESS_THRESHOLD * fullArea;
  interface ClassifiedBlock {
    col: number;
    row: number;
    ring: UtmCoord[];
    kind: BlockKind;
    full: boolean;
  }
  const survivors: ClassifiedBlock[] = [];
  for (const block of blocks) {
    const key = blockKey(block.col, block.row);
    const survivedArea = survivedAreaByBlock.get(key);
    if (survivedArea === undefined) continue;
    survivors.push({
      col: block.col,
      row: block.row,
      ring: block.ring,
      kind: 'residential',
      full: survivedArea >= fullnessThreshold,
    });
  }
  if (survivors.length === 0) return { parcels: [], blocks: [] };

  const squareIdx = pickPublicSquareIdx(survivors, downtown.utm);
  survivors[squareIdx]!.kind = 'public-square';
  const sq = survivors[squareIdx]!;

  const schoolIdx = pickSchoolIdx(survivors, sq);
  if (schoolIdx !== -1) survivors[schoolIdx]!.kind = 'school';

  for (let i = 0; i < survivors.length; i++) {
    if (i === squareIdx || i === schoolIdx) continue;
    const b = survivors[i]!;
    const cheby = Math.max(Math.abs(b.col - sq.col), Math.abs(b.row - sq.row));
    b.kind = cheby <= 1 ? 'commercial' : 'residential';
  }

  // ── Phase 3: per-kind parcel resolution.
  const parcels: Parcel[] = [];
  const parcelLandFraction = new Map<number, number>();
  let nextId = 1;
  for (const cb of survivors) {
    const key = blockKey(cb.col, cb.row);
    if (cb.kind === 'public-square') {
      parcels.push({
        id: nextId++,
        blockCol: cb.col,
        blockRow: cb.row,
        lotNumber: 1,
        ring: cb.ring.slice(),
        areaSqM: ringArea(cb.ring),
        use: 'public-square',
        frontageStreet: null,
        ownerId: 'municipality',
      });
      continue;
    }
    if (cb.kind === 'school') {
      parcels.push({
        id: nextId++,
        blockCol: cb.col,
        blockRow: cb.row,
        lotNumber: 1,
        ring: cb.ring.slice(),
        areaSqM: ringArea(cb.ring),
        use: 'school',
        frontageStreet: null,
        ownerId: 'school-district',
      });
      continue;
    }
    if (cb.kind === 'commercial') {
      // Re-subdivide at the narrower commercial width and re-apply the water test + degeneracy filter.
      const block: Block = { col: cb.col, row: cb.row, ring: cb.ring, kind: 'commercial' };
      const rect = blockRect(townsite, cb.col, cb.row);
      const plans = layoutLots(rect, alleyAxis, COMMERCIAL_LOT_WIDTH_METERS, block, streetGrid);
      for (const plan of plans) {
        const result = clipPlanToBlock(plan.ring, cb.ring);
        if (result === null) continue;
        const id = nextId++;
        parcels.push({
          id,
          blockCol: cb.col,
          blockRow: cb.row,
          lotNumber: plan.lotNumber,
          ring: result.ring,
          areaSqM: result.landArea,
          use: 'commercial',
          frontageStreet: plan.frontageStreet,
          ownerId: founder.id,
        });
        parcelLandFraction.set(id, result.landFraction);
      }
      continue;
    }
    // Residential: reuse the basic parcels we already kept.
    const basic = basicByBlock.get(key)!;
    for (const bp of basic) {
      const id = nextId++;
      parcels.push({
        id,
        blockCol: bp.blockCol,
        blockRow: bp.blockRow,
        lotNumber: bp.lotNumber,
        ring: bp.ring,
        areaSqM: bp.landArea,
        use: 'residential',
        frontageStreet: bp.frontageStreet,
        ownerId: founder.id,
      });
      parcelLandFraction.set(id, bp.landFraction);
    }
  }

  // ── Phase 4: tag 1–2 church lots in commercial blocks adjacent to the square.
  // Only parcels with landFraction >= MIN_LAND_FRACTION_FULL are eligible
  // (we don't want to put a church on a sliver of a parcel).
  tagChurchLots(parcels, survivors, parcelLandFraction, fullArea);

  const outBlocks: Block[] = survivors.map((cb) => ({
    col: cb.col,
    row: cb.row,
    ring: cb.ring,
    kind: cb.kind,
  }));
  return { parcels, blocks: outBlocks };
}

function pickPublicSquareIdx(survivors: ReadonlyArray<{ col: number; row: number; ring: UtmCoord[]; full: boolean }>, anchor: UtmCoord): number {
  const fullPool: number[] = [];
  for (let i = 0; i < survivors.length; i++) if (survivors[i]!.full) fullPool.push(i);
  const pool = fullPool.length > 0 ? fullPool : survivors.map((_, i) => i);
  return pickNearestIdx(pool, survivors, anchor);
}

function pickSchoolIdx(survivors: ReadonlyArray<{ col: number; row: number; ring: UtmCoord[]; full: boolean }>, square: { col: number; row: number; ring: UtmCoord[] }): number {
  const candidates: number[] = [];
  for (let i = 0; i < survivors.length; i++) {
    const b = survivors[i]!;
    if (b.col === square.col && b.row === square.row) continue;
    if (!b.full) continue;
    if (Math.max(Math.abs(b.col - square.col), Math.abs(b.row - square.row)) < 2) continue;
    candidates.push(i);
  }
  if (candidates.length === 0) return -1;
  return pickNearestIdx(candidates, survivors, ringCentroid(square.ring));
}

function pickNearestIdx(pool: ReadonlyArray<number>, survivors: ReadonlyArray<{ col: number; row: number; ring: UtmCoord[] }>, target: UtmCoord): number {
  let bestIdx = pool[0]!;
  let bestDist = Infinity;
  for (const idx of pool) {
    const c = ringCentroid(survivors[idx]!.ring);
    const d = (c.e - target.e) ** 2 + (c.n - target.n) ** 2;
    if (d < bestDist - 1e-6) {
      bestDist = d;
      bestIdx = idx;
    } else if (Math.abs(d - bestDist) < 1e-6) {
      const cur = survivors[bestIdx]!;
      const b = survivors[idx]!;
      if (b.col > cur.col || (b.col === cur.col && b.row > cur.row)) {
        bestIdx = idx;
      }
    }
  }
  return bestIdx;
}

function tagChurchLots(
  parcels: Parcel[],
  survivors: ReadonlyArray<{ col: number; row: number; ring: UtmCoord[]; kind: BlockKind }>,
  parcelLandFraction: ReadonlyMap<number, number>,
  fullBlockArea: number,
): void {
  const square = survivors.find((b) => b.kind === 'public-square');
  if (!square) return;
  const squareCenter = ringCentroid(square.ring);
  const adjacent = survivors.filter(
    (b) =>
      b.kind === 'commercial' &&
      Math.abs(b.col - square.col) + Math.abs(b.row - square.row) === 1,
  );

  // Only place churches in blocks that retain >=75% of their full inset block
  // area. Ring length isn't a reliable proxy for "clipped" — the townsite cut
  // can land exactly on a block edge and leave a 4-vertex shape that's tiny
  // (e.g., a triangle clipped to a quad). Area is the honest measure.
  const isFullEnough = (b: { ring: UtmCoord[] }) =>
    ringArea(b.ring) >= MIN_BLOCK_AREA_FOR_CHURCH * fullBlockArea;
  const ordered = adjacent.filter(isFullEnough);

  let tagged = 0;
  for (const block of ordered) {
    if (tagged >= MAX_CHURCH_LOTS) break;
    let bestIdx = -1;
    let bestFrac = -Infinity;
    let bestDist = Infinity;
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i]!;
      if (p.blockCol !== block.col || p.blockRow !== block.row) continue;
      if (p.use !== 'commercial') continue;
      const frac = parcelLandFraction.get(p.id) ?? 0;
      if (frac < MIN_LAND_FRACTION_FULL) continue;
      const c = ringCentroid(p.ring);
      const d = (c.e - squareCenter.e) ** 2 + (c.n - squareCenter.n) ** 2;
      // Sort key: prefer higher landFraction (further from water within the
      // block), break ties by proximity to the public square.
      const better = frac > bestFrac + 1e-6
        || (Math.abs(frac - bestFrac) < 1e-6 && d < bestDist);
      if (better) {
        bestFrac = frac;
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) continue;
    parcels[bestIdx]!.use = 'church';
    tagged++;
  }
}

interface LotPlan {
  lotNumber: number;
  ring: UtmCoord[];
  frontageStreet: string | null;
}

interface BlockRect {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

function layoutLots(
  rect: BlockRect,
  alleyAxis: AlleyAxis,
  lotWidth: number,
  block: Block,
  streetGrid: StreetGrid,
): LotPlan[] {
  const lots: LotPlan[] = [];
  if (alleyAxis === 'east-west') {
    const blockSpanE = rect.maxE - rect.minE;
    const lotsPerRow = Math.max(1, Math.floor(blockSpanE / lotWidth));
    const actualWidth = blockSpanE / lotsPerRow;
    const midN = (rect.minN + rect.maxN) / 2;
    const alleyS = midN - ALLEY_WIDTH_METERS / 2;
    const alleyN = midN + ALLEY_WIDTH_METERS / 2;
    const southStreet = streetGrid.streets.find((s) => s.axis === 'parallel' && s.index === block.row);
    const northStreet = streetGrid.streets.find((s) => s.axis === 'parallel' && s.index === block.row + 1);
    let lotNum = 1;
    for (let i = 0; i < lotsPerRow; i++) {
      const e0 = rect.minE + i * actualWidth;
      const e1 = e0 + actualWidth;
      lots.push({
        lotNumber: lotNum++,
        ring: [
          { e: e0, n: rect.minN },
          { e: e1, n: rect.minN },
          { e: e1, n: alleyS },
          { e: e0, n: alleyS },
        ],
        frontageStreet: southStreet?.name ?? null,
      });
    }
    for (let i = 0; i < lotsPerRow; i++) {
      const e0 = rect.minE + i * actualWidth;
      const e1 = e0 + actualWidth;
      lots.push({
        lotNumber: lotNum++,
        ring: [
          { e: e0, n: alleyN },
          { e: e1, n: alleyN },
          { e: e1, n: rect.maxN },
          { e: e0, n: rect.maxN },
        ],
        frontageStreet: northStreet?.name ?? null,
      });
    }
  } else {
    const blockSpanN = rect.maxN - rect.minN;
    const lotsPerCol = Math.max(1, Math.floor(blockSpanN / lotWidth));
    const actualWidth = blockSpanN / lotsPerCol;
    const midE = (rect.minE + rect.maxE) / 2;
    const alleyW = midE - ALLEY_WIDTH_METERS / 2;
    const alleyE = midE + ALLEY_WIDTH_METERS / 2;
    const westStreet = streetGrid.streets.find((s) => s.axis === 'meridian' && s.index === block.col);
    const eastStreet = streetGrid.streets.find((s) => s.axis === 'meridian' && s.index === block.col + 1);
    let lotNum = 1;
    for (let i = 0; i < lotsPerCol; i++) {
      const n0 = rect.minN + i * actualWidth;
      const n1 = n0 + actualWidth;
      lots.push({
        lotNumber: lotNum++,
        ring: [
          { e: rect.minE, n: n0 },
          { e: alleyW, n: n0 },
          { e: alleyW, n: n1 },
          { e: rect.minE, n: n1 },
        ],
        frontageStreet: westStreet?.name ?? null,
      });
    }
    for (let i = 0; i < lotsPerCol; i++) {
      const n0 = rect.minN + i * actualWidth;
      const n1 = n0 + actualWidth;
      lots.push({
        lotNumber: lotNum++,
        ring: [
          { e: alleyE, n: n0 },
          { e: rect.maxE, n: n0 },
          { e: rect.maxE, n: n1 },
          { e: alleyE, n: n1 },
        ],
        frontageStreet: eastStreet?.name ?? null,
      });
    }
  }
  return lots;
}

function blockKey(col: number, row: number): string {
  return `${col},${row}`;
}

interface ClipResult {
  ring: UtmCoord[];
  landArea: number;
  /** landArea / area(plan rectangle). */
  landFraction: number;
}

/**
 * Clips a plan rectangle by the block ring and returns the surviving polygon
 * plus the fraction of the ORIGINAL plan rectangle that survived. Water
 * clipping is implicit: the block ring is already the intersection of the
 * block rectangle with the (water-clipped, simplified) townsite ring.
 *
 * Drops any sliver that:
 *   - falls below MIN_PARCEL_AREA_M2 (absolute), or
 *   - retains <MIN_LAND_FRACTION_KEEP of its plan area, or
 *   - has a clipped bbox span <MIN_DIMENSION_RATIO of the plan rect span
 *     in either axis (degenerate "thin" slivers, e.g. a diagonal townsite
 *     edge leaving a long thin triangle).
 */
function clipPlanToBlock(
  planRing: readonly UtmCoord[],
  blockRing: readonly UtmCoord[],
): ClipResult | null {
  const planArea = ringArea(planRing);
  if (planArea < 1) return null;
  const planBbox = bbox(planRing);
  const planSpanE = planBbox.maxE - planBbox.minE;
  const planSpanN = planBbox.maxN - planBbox.minN;

  const land = intersectPolygons(planRing, blockRing);
  if (land === null) return null;
  const landArea = ringArea(land);

  if (landArea < MIN_PARCEL_AREA_M2) return null;
  const landFraction = landArea / planArea;
  if (landFraction < MIN_LAND_FRACTION_KEEP) return null;
  const landBbox = bbox(land);
  if ((landBbox.maxE - landBbox.minE) / planSpanE < MIN_DIMENSION_RATIO) return null;
  if ((landBbox.maxN - landBbox.minN) / planSpanN < MIN_DIMENSION_RATIO) return null;

  return { ring: land, landArea, landFraction };
}

function bbox(ring: readonly UtmCoord[]): { minE: number; maxE: number; minN: number; maxN: number } {
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  for (const p of ring) {
    if (p.e < minE) minE = p.e;
    if (p.e > maxE) maxE = p.e;
    if (p.n < minN) minN = p.n;
    if (p.n > maxN) maxN = p.n;
  }
  return { minE, maxE, minN, maxN };
}

function ringArea(ring: readonly UtmCoord[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.e * b.n - b.e * a.n;
  }
  return Math.abs(twice) / 2;
}

export { STREET_GRID_DIVISIONS };
