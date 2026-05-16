import polygonClipping from 'polygon-clipping';
import type { UtmCoord } from '../geo';
import type { DowntownAnchor } from './downtown';
import { STREET_GRID_DIVISIONS } from './streets';
import type { Townsite } from './townsite';

export interface Block {
  col: number;
  row: number;
  /** Closed CCW polygon ring. */
  ring: UtmCoord[];
  publicSquare: boolean;
}

/**
 * Tiles the unclipped township rectangle into a `divisions × divisions` grid,
 * then intersects each block rectangle with the township polygon. Blocks fully
 * inside the township remain rectangular; blocks straddling the township
 * boundary are clipped to the township's exact boundary; blocks fully outside
 * the township are dropped.
 */
export function buildBlocks(townsite: Townsite, downtown: DowntownAnchor): Block[] {
  const divisions = STREET_GRID_DIVISIONS;
  const side = townsite.sideMeters;
  const step = side / divisions;
  const minE = townsite.unclippedCenter.e - side / 2;
  const minN = townsite.unclippedCenter.n - side / 2;

  const townshipPoly: polygonClipping.Geom = [[ringToClosedPairs(townsite.ring)]];

  const blocks: Block[] = [];
  for (let row = 0; row < divisions; row++) {
    for (let col = 0; col < divisions; col++) {
      const e0 = minE + col * step;
      const n0 = minN + row * step;
      const rectRing: UtmCoord[] = [
        { e: e0, n: n0 },
        { e: e0 + step, n: n0 },
        { e: e0 + step, n: n0 + step },
        { e: e0, n: n0 + step },
      ];
      const subject: polygonClipping.Geom = [[ringToClosedPairs(rectRing)]];
      const result = polygonClipping.intersection(subject, townshipPoly);
      if (result.length === 0) continue;

      let bestRing: polygonClipping.Ring | null = null;
      let bestArea = 0;
      for (const poly of result) {
        const outer = poly[0];
        if (!outer || outer.length < 4) continue;
        const a = ringAreaClosed(outer);
        if (a > bestArea) {
          bestArea = a;
          bestRing = outer;
        }
      }
      if (bestRing === null) continue;
      blocks.push({ col, row, ring: closedPairsToRing(bestRing), publicSquare: false });
    }
  }

  if (blocks.length === 0) return blocks;

  const a = downtown.utm;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const c = ringCentroid(blocks[i]!.ring);
    const d = (c.e - a.e) ** 2 + (c.n - a.n) ** 2;
    if (d < bestDist - 1e-6) {
      bestDist = d;
      bestIdx = i;
    } else if (Math.abs(d - bestDist) < 1e-6) {
      const cur = blocks[bestIdx]!;
      const b = blocks[i]!;
      if (b.col > cur.col || (b.col === cur.col && b.row > cur.row)) {
        bestIdx = i;
      }
    }
  }
  blocks[bestIdx]!.publicSquare = true;

  return blocks;
}

function ringToClosedPairs(ring: readonly UtmCoord[]): polygonClipping.Ring {
  const out: polygonClipping.Pair[] = ring.map((p) => [p.e, p.n]);
  out.push([ring[0]!.e, ring[0]!.n]);
  return out;
}

function closedPairsToRing(pairs: polygonClipping.Ring): UtmCoord[] {
  const out: UtmCoord[] = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    const p = pairs[i]!;
    out.push({ e: p[0], n: p[1] });
  }
  return out;
}

function ringAreaClosed(pairs: polygonClipping.Ring): number {
  let twice = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    const a = pairs[i]!;
    const b = pairs[i + 1]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twice) / 2;
}

function ringCentroid(ring: readonly UtmCoord[]): UtmCoord {
  let e = 0;
  let n = 0;
  for (const p of ring) {
    e += p.e;
    n += p.n;
  }
  return { e: e / ring.length, n: n / ring.length };
}
