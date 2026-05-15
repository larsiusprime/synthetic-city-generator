import type { GridExtent, UtmCoord } from '../geo';
import type { RiverPath } from '../terrain';
import { type GhostGrid, type GridLine, SECTION_METERS } from './grid';

export type DowntownReason = 'river-section-intersection' | 'centroid-section-corner';

export interface DowntownAnchor {
  utm: UtmCoord;
  reason: DowntownReason;
}

/**
 * Picks where the future city's downtown will be platted.
 *
 * - With a river: the intersection of the river polyline and a section line
 *   closest to the terrain's centroid. Historically, towns were chartered
 *   where the river crossed a survey line.
 * - Without a river: the section corner nearest the terrain's centroid.
 */
export function pickDowntownAnchor(
  extent: GridExtent,
  grid: GhostGrid,
  river: RiverPath | null,
): DowntownAnchor {
  const centroid: UtmCoord = {
    e: (extent.minE + extent.maxE) / 2,
    n: (extent.minN + extent.maxN) / 2,
  };

  if (river !== null) {
    const intersections = collectRiverGridIntersections(grid.lines, river.points);
    if (intersections.length > 0) {
      const closest = nearest(intersections, centroid);
      return { utm: closest, reason: 'river-section-intersection' };
    }
  }

  const corner: UtmCoord = {
    e: grid.origin.e + Math.round((centroid.e - grid.origin.e) / SECTION_METERS) * SECTION_METERS,
    n: grid.origin.n + Math.round((centroid.n - grid.origin.n) / SECTION_METERS) * SECTION_METERS,
  };
  return { utm: corner, reason: 'centroid-section-corner' };
}

function collectRiverGridIntersections(lines: readonly GridLine[], river: readonly UtmCoord[]): UtmCoord[] {
  const out: UtmCoord[] = [];
  for (let i = 1; i < river.length; i++) {
    const a = river[i - 1]!;
    const b = river[i]!;
    for (const line of lines) {
      const hit = segmentLineIntersection(a, b, line);
      if (hit !== null) out.push(hit);
    }
  }
  return out;
}

function segmentLineIntersection(a: UtmCoord, b: UtmCoord, line: GridLine): UtmCoord | null {
  if (line.direction === 'meridian') {
    const x = line.a.e;
    const ax = a.e - x;
    const bx = b.e - x;
    if (ax === 0 && bx === 0) return null;
    if ((ax > 0 && bx > 0) || (ax < 0 && bx < 0)) return null;
    const dx = b.e - a.e;
    if (dx === 0) return null;
    const t = (x - a.e) / dx;
    const y = a.n + t * (b.n - a.n);
    if (y < line.a.n || y > line.b.n) return null;
    return { e: x, n: y };
  }
  const y = line.a.n;
  const ay = a.n - y;
  const by = b.n - y;
  if (ay === 0 && by === 0) return null;
  if ((ay > 0 && by > 0) || (ay < 0 && by < 0)) return null;
  const dy = b.n - a.n;
  if (dy === 0) return null;
  const t = (y - a.n) / dy;
  const x = a.e + t * (b.e - a.e);
  if (x < line.a.e || x > line.b.e) return null;
  return { e: x, n: y };
}

function nearest(points: readonly UtmCoord[], target: UtmCoord): UtmCoord {
  let best = points[0]!;
  let bestSq = distSq(best, target);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const d = distSq(p, target);
    if (d < bestSq) {
      best = p;
      bestSq = d;
    }
  }
  return best;
}

function distSq(a: UtmCoord, b: UtmCoord): number {
  const de = a.e - b.e;
  const dn = a.n - b.n;
  return de * de + dn * dn;
}
