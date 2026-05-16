import polygonClipping from 'polygon-clipping';
import type { UtmCoord } from '../geo';

export function ringToClosedPairs(ring: readonly UtmCoord[]): polygonClipping.Ring {
  const out: polygonClipping.Pair[] = ring.map((p) => [p.e, p.n]);
  out.push([ring[0]!.e, ring[0]!.n]);
  return out;
}

export function closedPairsToRing(pairs: polygonClipping.Ring): UtmCoord[] {
  const out: UtmCoord[] = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    const p = pairs[i]!;
    out.push({ e: p[0], n: p[1] });
  }
  return out;
}

export function ringAreaClosed(pairs: polygonClipping.Ring): number {
  let twice = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    const a = pairs[i]!;
    const b = pairs[i + 1]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twice) / 2;
}

export function ringCentroid(ring: readonly UtmCoord[]): UtmCoord {
  let e = 0;
  let n = 0;
  for (const p of ring) {
    e += p.e;
    n += p.n;
  }
  return { e: e / ring.length, n: n / ring.length };
}

/**
 * Intersects two simple polygons (open rings, CCW) and returns the largest
 * outer ring of the result, or null if empty.
 */
export function intersectPolygons(
  a: readonly UtmCoord[],
  b: readonly UtmCoord[],
): UtmCoord[] | null {
  const result = polygonClipping.intersection(
    [[ringToClosedPairs(a)]],
    [[ringToClosedPairs(b)]],
  );
  return pickLargestOuterRing(result);
}

/**
 * Subtracts the given holes (e.g., water polygons) from a single polygon and
 * returns the largest connected outer ring of the result, or null if the
 * remaining land area is empty. Parcels split into multiple disjoint pieces
 * by the subtraction keep only their largest piece.
 */
export function subtractPolygons(
  a: readonly UtmCoord[],
  holes: readonly (readonly UtmCoord[])[],
): UtmCoord[] | null {
  if (holes.length === 0) return a.slice();
  const subject: polygonClipping.Geom = [[ringToClosedPairs(a)]];
  const subtract: polygonClipping.Geom = holes.map(
    (ring) => [ringToClosedPairs(ring)] as polygonClipping.Polygon,
  );
  const result = polygonClipping.difference(subject, subtract);
  return pickLargestOuterRing(result);
}

/**
 * Intersects a collection of subject polygons (open rings, CCW) against a
 * single clip polygon, returning all outer rings of the result as separate
 * `UtmCoord[]` rings. Used to crop a large multi-polygon (e.g., a full water
 * mask) down to a local bounding rectangle before doing many small clips.
 */
export function intersectMultiPolygons(
  subjects: readonly (readonly UtmCoord[])[],
  clip: readonly UtmCoord[],
): UtmCoord[][] {
  if (subjects.length === 0) return [];
  const subjectGeom: polygonClipping.Geom = subjects.map(
    (s) => [ringToClosedPairs(s)] as polygonClipping.Polygon,
  );
  const clipGeom: polygonClipping.Geom = [[ringToClosedPairs(clip)]];
  const result = polygonClipping.intersection(subjectGeom, clipGeom);
  const out: UtmCoord[][] = [];
  for (const poly of result) {
    const outer = poly[0];
    if (!outer || outer.length < 4) continue;
    out.push(closedPairsToRing(outer));
  }
  return out;
}

/**
 * Computes `subject \ subtract` (polygon difference) and returns each resulting
 * outer ring as a separate `UtmCoord[]`. Use this when the subtraction may
 * split the subject into multiple connected components (e.g., a corridor cut
 * through a rectangle) and the caller needs to pick a specific piece.
 */
export function differencePolygons(
  subject: readonly UtmCoord[],
  subtract: readonly UtmCoord[],
): UtmCoord[][] {
  const result = polygonClipping.difference(
    [[ringToClosedPairs(subject)]],
    [[ringToClosedPairs(subtract)]],
  );
  const out: UtmCoord[][] = [];
  for (const poly of result) {
    const outer = poly[0];
    if (!outer || outer.length < 4) continue;
    out.push(closedPairsToRing(outer));
  }
  return out;
}

/**
 * Builds a closed polygon by offsetting a polyline perpendicular by ±halfWidth.
 * Uses miter joins at interior vertices (no miter limit — assumes smoothly
 * curving polylines, which is the case for our procedurally-generated rivers).
 * For near-180° reversals (denom < 0.001) falls back to the incoming segment's
 * normal so the offset stays bounded.
 */
export function bufferPolyline(points: readonly UtmCoord[], halfWidth: number): UtmCoord[] {
  const n = points.length;
  if (n < 2) return [];

  const ring: UtmCoord[] = [];
  for (let i = 0; i < n; i++) ring.push(offsetVertex(points, i, halfWidth));
  for (let i = n - 1; i >= 0; i--) ring.push(offsetVertex(points, i, -halfWidth));
  return ring;
}

function offsetVertex(points: readonly UtmCoord[], i: number, offset: number): UtmCoord {
  const n = points.length;
  const p = points[i]!;
  if (i === 0) {
    const nrm = segmentNormal(points[0]!, points[1]!);
    return { e: p.e + offset * nrm.x, n: p.n + offset * nrm.y };
  }
  if (i === n - 1) {
    const nrm = segmentNormal(points[n - 2]!, points[n - 1]!);
    return { e: p.e + offset * nrm.x, n: p.n + offset * nrm.y };
  }
  const n1 = segmentNormal(points[i - 1]!, points[i]!);
  const n2 = segmentNormal(points[i]!, points[i + 1]!);
  const denom = 1 + n1.x * n2.x + n1.y * n2.y;
  if (Math.abs(denom) < 1e-3) {
    return { e: p.e + offset * n1.x, n: p.n + offset * n1.y };
  }
  const sx = (n1.x + n2.x) / denom;
  const sy = (n1.y + n2.y) / denom;
  return { e: p.e + offset * sx, n: p.n + offset * sy };
}

function segmentNormal(a: UtmCoord, b: UtmCoord): { x: number; y: number } {
  const dx = b.e - a.e;
  const dy = b.n - a.n;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: -dy / len, y: dx / len };
}

function pickLargestOuterRing(result: polygonClipping.MultiPolygon): UtmCoord[] | null {
  if (result.length === 0) return null;
  let bestRing: polygonClipping.Ring | null = null;
  let bestArea = 0;
  for (const poly of result) {
    const outer = poly[0];
    if (!outer || outer.length < 4) continue;
    const ar = ringAreaClosed(outer);
    if (ar > bestArea) {
      bestArea = ar;
      bestRing = outer;
    }
  }
  if (bestRing === null) return null;
  return closedPairsToRing(bestRing);
}
