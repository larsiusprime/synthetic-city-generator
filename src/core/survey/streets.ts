import type { UtmCoord } from '../geo';
import { clipLineByPolygon, clipLineByWaterMask, segmentIntersect, type WaterField } from './clip';
import { PRODUCE_NAMES, ordinal } from './names';
import type { Townsite, TownsiteBank } from './townsite';

export type StreetAxis = 'meridian' | 'parallel';
export type StreetNameScheme = 'numbered' | 'produce';

export interface Street {
  name: string;
  axis: StreetAxis;
  /** Position index 0..divisions along this axis (0 = south/west). */
  index: number;
  /** LineString points (≥ 2). Cardinal lines clipped to townsite ring and the dry portion of the water mask. */
  points: UtmCoord[];
}

export interface StreetGrid {
  divisions: number;
  streetsScheme: StreetNameScheme;
  avenuesScheme: StreetNameScheme;
  streets: Street[];
}

const DIVISIONS = 8;
/** Right-of-way width of a single street in meters (~60 ft, the standard
 * for residential streets in 19th-century PLS-platted Midwestern towns).
 * Block rectangles are inset by half this on every side to reserve the
 * street ROW from the platted block. */
const STREET_WIDTH_METERS = 18.29;

interface Trunk {
  /** Index of the trunk on the streets (E-W) axis, or null if this axis has no trunk. */
  streetsIdx: number | null;
  streetsName: string;
  avenuesIdx: number | null;
  avenuesName: string;
}

function trunkFor(bank: TownsiteBank | null): Trunk {
  const center = DIVISIONS / 2;
  if (bank === null) {
    return {
      streetsIdx: center,
      streetsName: 'Main Street',
      avenuesIdx: center,
      avenuesName: 'First Avenue',
    };
  }
  // For river cities the only iconic trunk is the inland one — the one
  // perpendicular to the river, passing through the anchor. The river-parallel
  // edge ("Front Street") is dropped per Stage 4 refinement.
  if (bank === 'north' || bank === 'south') {
    return { streetsIdx: null, streetsName: '', avenuesIdx: center, avenuesName: 'Main Avenue' };
  }
  return { streetsIdx: center, streetsName: 'Main Street', avenuesIdx: null, avenuesName: '' };
}

function nameAt(index: number, axis: 'street' | 'avenue', scheme: StreetNameScheme): string {
  const suffix = axis === 'street' ? 'Street' : 'Avenue';
  if (scheme === 'numbered') return `${ordinal(index + 1)} ${suffix}`;
  const produce = PRODUCE_NAMES[index];
  if (produce === undefined) throw new Error(`PRODUCE_NAMES exhausted at index ${index}`);
  return `${produce} ${suffix}`;
}

function clipCardinalLine(
  a: UtmCoord,
  b: UtmCoord,
  townsite: Townsite,
  water: WaterField | null,
): Array<[UtmCoord, UtmCoord]> {
  const insideTownsite = clipLineByPolygon(a, b, townsite.ring);
  if (water === null) return insideTownsite;
  const dryPieces: Array<[UtmCoord, UtmCoord]> = [];
  for (const [s, e] of insideTownsite) {
    dryPieces.push(...clipLineByWaterMask(s, e, water));
  }
  return dryPieces.filter(([s, e]) => Math.hypot(e.e - s.e, e.n - s.n) > 1);
}

export function buildStreets(
  townsite: Townsite,
  water: WaterField | null,
  streetsNumberedCoin: boolean,
): StreetGrid {
  const half = townsite.sideMeters / 2;
  const minE = townsite.unclippedCenter.e - half;
  const minN = townsite.unclippedCenter.n - half;
  const step = townsite.sideMeters / DIVISIONS;
  const trunk = trunkFor(townsite.bank);

  const streetsScheme: StreetNameScheme = streetsNumberedCoin ? 'numbered' : 'produce';
  const avenuesScheme: StreetNameScheme = streetsNumberedCoin ? 'produce' : 'numbered';

  const streets: Street[] = [];

  for (let i = 0; i <= DIVISIONS; i++) {
    const n = minN + i * step;
    const a: UtmCoord = { e: minE, n };
    const b: UtmCoord = { e: minE + townsite.sideMeters, n };
    const pieces = clipCardinalLine(a, b, townsite, water);
    if (pieces.length === 0) continue;
    const name =
      trunk.streetsIdx === i ? trunk.streetsName : nameAt(i, 'street', streetsScheme);
    for (const [s, e] of pieces) {
      streets.push({ name, axis: 'parallel', index: i, points: [s, e] });
    }
  }

  for (let i = 0; i <= DIVISIONS; i++) {
    const e = minE + i * step;
    const a: UtmCoord = { e, n: minN };
    const b: UtmCoord = { e, n: minN + townsite.sideMeters };
    const pieces = clipCardinalLine(a, b, townsite, water);
    if (pieces.length === 0) continue;
    const name =
      trunk.avenuesIdx === i ? trunk.avenuesName : nameAt(i, 'avenue', avenuesScheme);
    for (const [s, eEnd] of pieces) {
      streets.push({ name, axis: 'meridian', index: i, points: [s, eEnd] });
    }
  }

  return {
    divisions: DIVISIONS,
    streetsScheme,
    avenuesScheme,
    streets: keepMainComponent(streets),
  };
}

/**
 * Drops street segments that aren't connected (directly or transitively) to
 * the main grid. Connectivity is by perpendicular intersection — two cardinal
 * streets connect when one's E-W segment crosses another's N-S segment within
 * each segment's clipped extent.
 */
function keepMainComponent(streets: Street[]): Street[] {
  const N = streets.length;
  if (N < 2) return streets;

  const parent = new Array<number>(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (streets[i]!.axis === streets[j]!.axis) continue;
      if (segmentIntersect(streets[i]!.points[0]!, streets[i]!.points[1]!, streets[j]!.points[0]!, streets[j]!.points[1]!) !== null) {
        union(i, j);
      }
    }
  }

  const sizes = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    const r = find(i);
    sizes.set(r, (sizes.get(r) ?? 0) + 1);
  }
  let mainRoot = -1;
  let mainSize = 0;
  for (const [r, s] of sizes) {
    if (s > mainSize) {
      mainSize = s;
      mainRoot = r;
    }
  }
  if (mainRoot === -1) return streets;
  return streets.filter((_, i) => find(i) === mainRoot);
}

export { DIVISIONS as STREET_GRID_DIVISIONS, STREET_WIDTH_METERS };
