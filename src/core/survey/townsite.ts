import type { UtmCoord } from '../geo';
import type { RiverPath } from '../terrain';
import { vectorizeIsoline } from '../terrain/vectorize';
import {
  buildBankConnectedMask,
  countMask,
  pointInPolygon,
  polygonArea,
  simplifyRing,
  tidyTownshipPolygon,
  type WaterField,
} from './clip';
import type { DowntownAnchor } from './downtown';
import { SECTION_METERS } from './grid';
import { bufferPolyline, differencePolygons } from './poly-ops';

/** Side length of a quarter-section townsite, in meters (= ½ mile). */
export const TOWNSITE_SIDE_METERS = SECTION_METERS / 2;

export type TownsiteBank = 'north' | 'south' | 'east' | 'west';

export interface Townsite {
  /** Downtown anchor (on the riverfront edge for river cities; at center for riverless). */
  anchor: UtmCoord;
  /** Geometric center of the unclipped rectangle. */
  unclippedCenter: UtmCoord;
  /**
   * Closed CCW polygon ring. For riverless cities this is a rectangle (4 corners).
   * For river cities clipped at the river, this is an irregular polygon.
   */
  ring: UtmCoord[];
  /** Notional side length (the original unclipped square's side). */
  sideMeters: number;
  bank: TownsiteBank | null;
}

/**
 * Quarter-section (½ mi × ½ mi = 160 acres) cardinal-aligned polygon.
 *
 * For a river city the townsite sits predominantly on one bank: the downtown
 * anchor lies at the midpoint of the riverfront edge, and the rectangle is
 * then clipped by the river polyline so the townsite never crosses the river.
 * For a riverless city the townsite is a centered rectangle (no clipping).
 */
/** Threshold for falling back to the raster-derived polygon when the polyline polygon's area is much larger. */
const POLYLINE_AREA_FALLBACK_RATIO = 1.15;

/** Douglas-Peucker tolerance (meters) for cleaning up stairstep noise in the raster fallback ring. */
const RASTER_SIMPLIFY_EPSILON = 6;

/**
 * Half-width of the river corridor (meters) we subtract from the townsite
 * rectangle. The actual wet portion of a river is ~72 m from centerline
 * (where the eased valley profile drops below SEA_LEVEL); 100 m gives a
 * small inland safety margin so the townsite ring never lies on water.
 * This also reduces how often we need the raster fallback below — the
 * corridor handles meanders that the bare centerline used to miss.
 */
const RIVER_HALF_WIDTH = 100;

export function buildTownsite(
  downtown: DowntownAnchor,
  bank: TownsiteBank | null,
  river: RiverPath | null,
  water: WaterField | null = null,
): Townsite {
  const half = TOWNSITE_SIDE_METERS / 2;
  const a = downtown.utm;

  let center: UtmCoord;
  switch (bank) {
    case 'north':
      center = { e: a.e, n: a.n + half };
      break;
    case 'south':
      center = { e: a.e, n: a.n - half };
      break;
    case 'east':
      center = { e: a.e + half, n: a.n };
      break;
    case 'west':
      center = { e: a.e - half, n: a.n };
      break;
    case null:
      center = a;
      break;
  }

  const rectRing: UtmCoord[] = [
    { e: center.e - half, n: center.n - half },
    { e: center.e + half, n: center.n - half },
    { e: center.e + half, n: center.n + half },
    { e: center.e - half, n: center.n + half },
  ];

  if (river === null || bank === null) {
    return {
      anchor: a,
      unclippedCenter: center,
      ring: rectRing,
      sideMeters: TOWNSITE_SIDE_METERS,
      bank,
    };
  }

  const seed = bankSeed(downtown, bank);
  const rect = {
    minE: center.e - half,
    maxE: center.e + half,
    minN: center.n - half,
    maxN: center.n + half,
  };
  // Subtract a buffered river corridor (centerline ± RIVER_HALF_WIDTH) from
  // the rectangle. Compared to clipping by the bare centerline this:
  //   (1) prevents the township ring from hanging over water on the river side, and
  //   (2) cleanly removes meander lobes that the centerline used to miss.
  const corridor = bufferPolyline(river.points, RIVER_HALF_WIDTH);
  const pieces = differencePolygons(rectRing, corridor);
  let candidate: UtmCoord[];
  if (pieces.length === 0) {
    candidate = rectRing;
  } else {
    const seedPiece = pieces.find((p) => pointInPolygon(seed, p));
    candidate = seedPiece ?? pieces[0]!;
  }
  let ring = tidyTownshipPolygon(candidate, rect, seed);
  if (ring.length < 3) ring = rectRing;

  // If a water mask is available, validate the polyline-clipped polygon against
  // the bank-connected dry region. If the polyline polygon's area significantly
  // exceeds the raster's, the polyline traced a "thin neck" out to an orphan
  // lobe (river meander going outside the rectangle and back) — fall back to
  // the raster-derived polygon.
  if (water !== null) {
    const bankMask = buildBankConnectedMask(water, rect, seed);
    const rasterArea = countMask(bankMask) * water.extent.cellSize * water.extent.cellSize;
    const polylineArea = polygonArea(ring);
    if (rasterArea > 0 && polylineArea > rasterArea * POLYLINE_AREA_FALLBACK_RATIO) {
      const rasterRing = polygonizeBankMask(bankMask, water.cols, water.rows, water.extent);
      if (rasterRing !== null) {
        // Douglas-Peucker the stairstep raster boundary into a sparse set of
        // straight segments that trace the underlying curve, then bbox-clip
        // and tidy.
        const simplified = simplifyRing(rasterRing, RASTER_SIMPLIFY_EPSILON);
        const tidied = tidyTownshipPolygon(simplified, rect, seed);
        if (tidied.length >= 3) ring = tidied;
      }
    }
  }

  return {
    anchor: a,
    unclippedCenter: center,
    ring,
    sideMeters: TOWNSITE_SIDE_METERS,
    bank,
  };
}

function polygonizeBankMask(
  mask: Uint8Array,
  cols: number,
  rows: number,
  extent: WaterField['extent'],
): UtmCoord[] | null {
  const chains = vectorizeIsoline(mask, cols, rows, 0.5, extent);
  let best: UtmCoord[] | null = null;
  let bestArea = 0;
  for (const chain of chains) {
    if (chain.length < 4) continue;
    const first = chain[0]!;
    const last = chain[chain.length - 1]!;
    if (first.e !== last.e || first.n !== last.n) continue;
    const area = polygonArea(chain);
    if (area > bestArea) {
      bestArea = area;
      best = chain;
    }
  }
  if (best === null) return null;
  return best.slice(0, -1);
}

/**
 * A point well inside the rectangle on the bank side, used as the "keep seed"
 * for polygon clipping. Located 75% of the way from the anchor (which sits at
 * the riverfront edge) to the far edge of the rectangle — solidly inland.
 */
export function bankSeed(downtown: DowntownAnchor, bank: TownsiteBank): UtmCoord {
  const half = TOWNSITE_SIDE_METERS / 2;
  const a = downtown.utm;
  switch (bank) {
    case 'north':
      return { e: a.e, n: a.n + 1.5 * half };
    case 'south':
      return { e: a.e, n: a.n - 1.5 * half };
    case 'east':
      return { e: a.e + 1.5 * half, n: a.n };
    case 'west':
      return { e: a.e - 1.5 * half, n: a.n };
  }
}

export function bankFromRiver(horizontal: boolean, riverSide: 'left' | 'right'): TownsiteBank {
  if (horizontal) {
    return riverSide === 'left' ? 'north' : 'south';
  }
  return riverSide === 'left' ? 'west' : 'east';
}

export function pickTownsiteBank(river: RiverPath | null): TownsiteBank | null {
  if (river === null) return null;
  return bankFromRiver(river.horizontal, river.citySide);
}
