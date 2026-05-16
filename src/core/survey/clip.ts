import type { GridExtent, UtmCoord } from '../geo';

const EPS = 1e-9;

export interface SegmentIntersection {
  point: UtmCoord;
  /** Parametric position along the first segment (a1→a2), in [0, 1]. */
  ta: number;
  /** Parametric position along the second segment (b1→b2), in [0, 1]. */
  tb: number;
}

export function segmentIntersect(
  a1: UtmCoord,
  a2: UtmCoord,
  b1: UtmCoord,
  b2: UtmCoord,
): SegmentIntersection | null {
  const dx1 = a2.e - a1.e;
  const dy1 = a2.n - a1.n;
  const dx2 = b2.e - b1.e;
  const dy2 = b2.n - b1.n;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < EPS) return null;
  const dx3 = a1.e - b1.e;
  const dy3 = a1.n - b1.n;
  const ta = (dx2 * dy3 - dy2 * dx3) / denom;
  const tb = (dx1 * dy3 - dy1 * dx3) / denom;
  if (ta < -EPS || ta > 1 + EPS || tb < -EPS || tb > 1 + EPS) return null;
  const taClamped = Math.max(0, Math.min(1, ta));
  return {
    point: { e: a1.e + taClamped * dx1, n: a1.n + taClamped * dy1 },
    ta: taClamped,
    tb: Math.max(0, Math.min(1, tb)),
  };
}

/** Ray-casting point-in-polygon. The ring is treated as implicitly closed. */
export function pointInPolygon(p: UtmCoord, ring: readonly UtmCoord[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.e;
    const yi = ring[i]!.n;
    const xj = ring[j]!.e;
    const yj = ring[j]!.n;
    const crosses =
      yi > p.n !== yj > p.n && p.e < ((xj - xi) * (p.n - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

interface ClipEvent {
  point: UtmCoord;
  /** Parametric position along the polyline: segment index + alpha. */
  polylineT: number;
  /** Index of the polygon edge intersected (edge i connects ring[i] → ring[(i+1)%N]). */
  polygonEdge: number;
  /** Parametric position along the polygon edge, in [0, 1]. */
  polygonAlpha: number;
}

function findCrossings(ring: readonly UtmCoord[], polyline: readonly UtmCoord[]): ClipEvent[] {
  const events: ClipEvent[] = [];
  const N = ring.length;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a1 = polyline[i]!;
    const a2 = polyline[i + 1]!;
    for (let j = 0; j < N; j++) {
      const b1 = ring[j]!;
      const b2 = ring[(j + 1) % N]!;
      const isect = segmentIntersect(a1, a2, b1, b2);
      if (!isect) continue;
      events.push({
        point: isect.point,
        polylineT: i + isect.ta,
        polygonEdge: j,
        polygonAlpha: isect.tb,
      });
    }
  }
  return events;
}

/**
 * Clips a polygon ring by a polyline that crosses it. Returns the polygon on
 * the side containing `keepSeed`, or `null` if the seed isn't inside either
 * resulting half.
 *
 * Handles a single entry-exit crossing pair; for multi-crossings, uses the
 * first entry and the last exit as the cut (the kept polygon may still
 * include some interior river segments, but the bulk clip is correct).
 */
export function clipPolygonByPolyline(
  ring: readonly UtmCoord[],
  polyline: readonly UtmCoord[],
  keepSeed: UtmCoord,
): UtmCoord[] | null {
  const events = findCrossings(ring, polyline);
  if (events.length < 2) {
    return pointInPolygon(keepSeed, ring) ? ring.slice() : null;
  }
  events.sort((a, b) => a.polylineT - b.polylineT);

  const polyStartInside = pointInPolygon(polyline[0]!, ring);
  const entry = polyStartInside ? events[1]! : events[0]!;
  const exit = polyStartInside ? events[events.length - 2]! : events[events.length - 1]!;

  const split = splitPolygonAt(ring, polyline, entry, exit);
  if (split === null) return null;
  if (pointInPolygon(keepSeed, split.sideA)) return split.sideA;
  if (pointInPolygon(keepSeed, split.sideB)) return split.sideB;
  return null;
}

function splitPolygonAt(
  ring: readonly UtmCoord[],
  polyline: readonly UtmCoord[],
  entry: ClipEvent,
  exit: ClipEvent,
): { sideA: UtmCoord[]; sideB: UtmCoord[] } | null {
  const N = ring.length;

  const interior: UtmCoord[] = [];
  const startIdx = Math.floor(entry.polylineT) + 1;
  const endIdx = Math.ceil(exit.polylineT) - 1;
  for (let i = startIdx; i <= endIdx; i++) {
    if (i >= 0 && i < polyline.length) interior.push(polyline[i]!);
  }

  const arcForward: UtmCoord[] = [];
  const arcBackward: UtmCoord[] = [];

  if (entry.polygonEdge === exit.polygonEdge) {
    if (exit.polygonAlpha < entry.polygonAlpha) {
      let v = (exit.polygonEdge + 1) % N;
      for (let k = 0; k < N; k++) {
        arcForward.push(ring[v]!);
        v = (v + 1) % N;
      }
    } else {
      let v = exit.polygonEdge;
      for (let k = 0; k < N; k++) {
        arcBackward.push(ring[v]!);
        v = (v - 1 + N) % N;
      }
    }
  } else {
    let edge = exit.polygonEdge;
    for (let k = 0; k < N; k++) {
      const nextV = (edge + 1) % N;
      arcForward.push(ring[nextV]!);
      if (nextV === (entry.polygonEdge + 1) % N) break;
      edge = nextV;
    }
    if (arcForward.length > 0) arcForward.length = Math.max(0, arcForward.length - 1);

    edge = exit.polygonEdge;
    for (let k = 0; k < N; k++) {
      if (edge === entry.polygonEdge) break;
      arcBackward.push(ring[edge]!);
      edge = (edge - 1 + N) % N;
    }
  }

  const sideA: UtmCoord[] = [entry.point, ...interior, exit.point, ...arcForward];
  const sideB: UtmCoord[] = [
    exit.point,
    ...interior.slice().reverse(),
    entry.point,
    ...arcBackward.slice().reverse(),
  ];

  if (sideA.length < 3 || sideB.length < 3) return null;
  return { sideA, sideB };
}

/**
 * Clips a line segment by a polyline, returning the sub-segments on the
 * `keepSeed` side. The seed determines the bank: a sub-segment is kept if its
 * midpoint is on the same side of the polyline as the seed (approximately,
 * via point-in-polygon against a bank polygon built on the fly is overkill —
 * we just check that the line's midpoint and the seed lie on the same side of
 * each crossed polyline segment).
 *
 * Returns an array of `[startPoint, endPoint]` pairs.
 */
export function clipLineByPolyline(
  start: UtmCoord,
  end: UtmCoord,
  polyline: readonly UtmCoord[],
  keepSeed: UtmCoord,
): Array<[UtmCoord, UtmCoord]> {
  const crossings: Array<{ point: UtmCoord; t: number }> = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const isect = segmentIntersect(start, end, a, b);
    if (!isect) continue;
    crossings.push({ point: isect.point, t: isect.ta });
  }
  crossings.sort((a, b) => a.t - b.t);

  const points: UtmCoord[] = [start, ...crossings.map((c) => c.point), end];
  const result: Array<[UtmCoord, UtmCoord]> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const mid: UtmCoord = { e: (a.e + b.e) / 2, n: (a.n + b.n) / 2 };
    if (sameSideOfPolyline(mid, keepSeed, polyline)) {
      result.push([a, b]);
    }
  }
  return result;
}

function sameSideOfPolyline(p: UtmCoord, q: UtmCoord, polyline: readonly UtmCoord[]): boolean {
  let nearestSegment = 0;
  let nearestDistSq = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
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
    const d = (p.e - cx) * (p.e - cx) + (p.n - cy) * (p.n - cy);
    if (d < nearestDistSq) {
      nearestDistSq = d;
      nearestSegment = i;
    }
  }
  const a = polyline[nearestSegment]!;
  const b = polyline[nearestSegment + 1]!;
  const sideP = (b.e - a.e) * (p.n - a.n) - (b.n - a.n) * (p.e - a.e);
  const sideQ = (b.e - a.e) * (q.n - a.n) - (b.n - a.n) * (q.e - a.e);
  return sideP * sideQ >= 0;
}

/**
 * Offsets a polyline perpendicular to its direction of travel by `distance`
 * meters. `side` selects which side of the polyline: 'left' is +90° CCW from
 * flow, 'right' is -90°. Naive implementation — sharp turns can self-intersect.
 */
export function offsetPolyline(
  polyline: readonly UtmCoord[],
  distance: number,
  side: 'left' | 'right',
): UtmCoord[] {
  if (polyline.length < 2) return polyline.slice();
  const sign = side === 'left' ? 1 : -1;
  const out: UtmCoord[] = new Array(polyline.length);

  for (let i = 0; i < polyline.length; i++) {
    let nx: number;
    let ny: number;
    if (i === 0) {
      const dx = polyline[1]!.e - polyline[0]!.e;
      const dy = polyline[1]!.n - polyline[0]!.n;
      const len = Math.hypot(dx, dy) || 1;
      nx = (-dy / len) * sign;
      ny = (dx / len) * sign;
    } else if (i === polyline.length - 1) {
      const dx = polyline[i]!.e - polyline[i - 1]!.e;
      const dy = polyline[i]!.n - polyline[i - 1]!.n;
      const len = Math.hypot(dx, dy) || 1;
      nx = (-dy / len) * sign;
      ny = (dx / len) * sign;
    } else {
      const dx1 = polyline[i]!.e - polyline[i - 1]!.e;
      const dy1 = polyline[i]!.n - polyline[i - 1]!.n;
      const len1 = Math.hypot(dx1, dy1) || 1;
      const dx2 = polyline[i + 1]!.e - polyline[i]!.e;
      const dy2 = polyline[i + 1]!.n - polyline[i]!.n;
      const len2 = Math.hypot(dx2, dy2) || 1;
      const nx1 = (-dy1 / len1) * sign;
      const ny1 = (dx1 / len1) * sign;
      const nx2 = (-dy2 / len2) * sign;
      const ny2 = (dx2 / len2) * sign;
      const bx = nx1 + nx2;
      const by = ny1 + ny2;
      const blen = Math.hypot(bx, by) || 1;
      const bxn = bx / blen;
      const byn = by / blen;
      const cosHalf = bxn * nx1 + byn * ny1;
      const scale = Math.abs(cosHalf) < 0.1 ? 1 : 1 / cosHalf;
      nx = bxn * scale;
      ny = byn * scale;
    }
    out[i] = {
      e: polyline[i]!.e + nx * distance,
      n: polyline[i]!.n + ny * distance,
    };
  }
  return out;
}

/**
 * Maps a townsite bank ('north' | 'south' | 'east' | 'west') and the river's
 * orientation onto a left/right side of the river's flow.
 */
export function riverSideForBank(
  bank: 'north' | 'south' | 'east' | 'west',
  horizontal: boolean,
): 'left' | 'right' {
  if (horizontal) {
    return bank === 'north' ? 'left' : 'right';
  }
  return bank === 'west' ? 'left' : 'right';
}

export interface WaterField {
  mask: Uint8Array;
  cols: number;
  rows: number;
  extent: GridExtent;
}

export interface Rectangle {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

/**
 * Sutherland-Hodgman polygon clip against an axis-aligned rectangle. Returns
 * a polygon strictly inside the rectangle. Vertices outside are replaced by
 * their projection onto the boundary.
 */
export function clipPolygonByRect(poly: readonly UtmCoord[], rect: Rectangle): UtmCoord[] {
  let out: UtmCoord[] = poly.slice();
  out = shClip(out, (p) => p.e >= rect.minE, (a, b) => interpolateAtE(a, b, rect.minE));
  out = shClip(out, (p) => p.e <= rect.maxE, (a, b) => interpolateAtE(a, b, rect.maxE));
  out = shClip(out, (p) => p.n >= rect.minN, (a, b) => interpolateAtN(a, b, rect.minN));
  out = shClip(out, (p) => p.n <= rect.maxN, (a, b) => interpolateAtN(a, b, rect.maxN));
  return out;
}

function shClip(
  poly: readonly UtmCoord[],
  inside: (p: UtmCoord) => boolean,
  cross: (a: UtmCoord, b: UtmCoord) => UtmCoord,
): UtmCoord[] {
  if (poly.length === 0) return [];
  const out: UtmCoord[] = [];
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i]!;
    const prev = poly[(i - 1 + poly.length) % poly.length]!;
    const currIn = inside(curr);
    const prevIn = inside(prev);
    if (currIn) {
      if (!prevIn) out.push(cross(prev, curr));
      out.push(curr);
    } else if (prevIn) {
      out.push(cross(prev, curr));
    }
  }
  return out;
}

function interpolateAtE(a: UtmCoord, b: UtmCoord, e: number): UtmCoord {
  const denom = b.e - a.e;
  const t = Math.abs(denom) < EPS ? 0 : (e - a.e) / denom;
  return { e, n: a.n + t * (b.n - a.n) };
}

function interpolateAtN(a: UtmCoord, b: UtmCoord, n: number): UtmCoord {
  const denom = b.n - a.n;
  const t = Math.abs(denom) < EPS ? 0 : (n - a.n) / denom;
  return { e: a.e + t * (b.e - a.e), n };
}

export function polygonArea(ring: readonly UtmCoord[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.e * b.n - b.e * a.n;
  }
  return Math.abs(twice) / 2;
}

interface SelfIntersection {
  i: number;
  j: number;
  point: UtmCoord;
}

function findFirstSelfIntersection(ring: readonly UtmCoord[]): SelfIntersection | null {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i]!;
    const a2 = ring[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = ring[j]!;
      const b2 = ring[(j + 1) % n]!;
      const isect = segmentIntersect(a1, a2, b1, b2);
      if (isect === null) continue;
      if (isect.ta < 1e-6 || isect.ta > 1 - 1e-6) continue;
      if (isect.tb < 1e-6 || isect.tb > 1 - 1e-6) continue;
      return { i, j, point: isect.point };
    }
  }
  return null;
}

function splitAtSelfIntersection(
  ring: readonly UtmCoord[],
  i: number,
  j: number,
  point: UtmCoord,
): [UtmCoord[], UtmCoord[]] {
  const n = ring.length;
  const lobeA: UtmCoord[] = [point];
  for (let k = i + 1; k <= j; k++) lobeA.push(ring[k]!);
  const lobeB: UtmCoord[] = [point];
  for (let k = j + 1; k < n; k++) lobeB.push(ring[k]!);
  for (let k = 0; k <= i; k++) lobeB.push(ring[k]!);
  return [lobeA, lobeB];
}

/**
 * Repeatedly splits a self-intersecting polygon at the first crossing pair,
 * keeping the lobe that contains the seed (or, if neither does, the larger
 * lobe by area). Terminates when the polygon is simple.
 */
export function keepSeedComponent(ring: UtmCoord[], seed: UtmCoord): UtmCoord[] {
  let current: UtmCoord[] = ring;
  // Safety bound: each split strictly reduces vertex count, so at most n iterations.
  for (let safety = current.length + 4; safety > 0; safety--) {
    const isect = findFirstSelfIntersection(current);
    if (isect === null) return current;
    const [a, b] = splitAtSelfIntersection(current, isect.i, isect.j, isect.point);
    let chosen: UtmCoord[];
    if (pointInPolygon(seed, a)) chosen = a;
    else if (pointInPolygon(seed, b)) chosen = b;
    else chosen = polygonArea(a) >= polygonArea(b) ? a : b;
    if (chosen.length >= current.length) return current;
    current = chosen;
  }
  return current;
}

/**
 * Post-processes a township polygon clipped by a river polyline:
 *   1. Clips any vertices that strayed outside the original bounding box.
 *   2. Splits self-intersections and keeps only the component containing the seed.
 */
export function tidyTownshipPolygon(
  ring: readonly UtmCoord[],
  rect: Rectangle,
  seed: UtmCoord,
): UtmCoord[] {
  const clipped = clipPolygonByRect(ring, rect);
  if (clipped.length < 3) return clipped;
  return keepSeedComponent(clipped, seed);
}

/**
 * Builds a binary mask of cells that are (a) inside the rectangle, (b) dry per
 * the water mask, and (c) connected to the seed cell via 4-connected flood fill.
 * Returned mask is in the same layout as the input water mask.
 */
export function buildBankConnectedMask(
  water: WaterField,
  rect: Rectangle,
  seed: UtmCoord,
): Uint8Array {
  const { mask: waterMask, cols, rows, extent } = water;
  const visited = new Uint8Array(cols * rows);

  const seedCol = Math.floor((seed.e - extent.minE) / extent.cellSize);
  const seedRow = Math.floor((seed.n - extent.minN) / extent.cellSize);
  if (seedCol < 0 || seedCol >= cols || seedRow < 0 || seedRow >= rows) return visited;
  if (waterMask[seedRow * cols + seedCol] !== 0) return visited;

  const inRect = (r: number, c: number): boolean => {
    const n = extent.minN + (r + 0.5) * extent.cellSize;
    const e = extent.minE + (c + 0.5) * extent.cellSize;
    return n >= rect.minN && n <= rect.maxN && e >= rect.minE && e <= rect.maxE;
  };

  if (!inRect(seedRow, seedCol)) return visited;

  const queue: number[] = [seedRow * cols + seedCol];
  visited[seedRow * cols + seedCol] = 1;
  while (queue.length > 0) {
    const idx = queue.pop()!;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const neighbors: Array<[number, number]> = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ];
    for (const [nr, nc] of neighbors) {
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nidx = nr * cols + nc;
      if (visited[nidx]) continue;
      if (waterMask[nidx] !== 0) continue;
      if (!inRect(nr, nc)) continue;
      visited[nidx] = 1;
      queue.push(nidx);
    }
  }

  return visited;
}

/** Counts non-zero cells in a mask. */
export function countMask(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
  return count;
}

/**
 * Douglas–Peucker simplification for a closed polygon ring. Drops vertices
 * whose perpendicular distance from the chord between their neighbors is
 * below `epsilon`. Cleans up stairstep noise from raster-derived polygons.
 *
 * Strategy for closed rings: pick the vertex farthest from `ring[0]` as a
 * second anchor, split the ring into two open polylines at those anchors,
 * simplify each independently, then stitch.
 */
export function simplifyRing(ring: readonly UtmCoord[], epsilon: number): UtmCoord[] {
  const n = ring.length;
  if (n < 4) return ring.slice();

  let anchor = 0;
  let maxDistSq = 0;
  for (let i = 1; i < n; i++) {
    const dx = ring[i]!.e - ring[0]!.e;
    const dy = ring[i]!.n - ring[0]!.n;
    const d = dx * dx + dy * dy;
    if (d > maxDistSq) {
      maxDistSq = d;
      anchor = i;
    }
  }
  if (anchor === 0) return ring.slice();

  const part1 = ring.slice(0, anchor + 1);
  const part2: UtmCoord[] = ring.slice(anchor).concat([ring[0]!]);

  const simp1 = douglasPeucker(part1, epsilon);
  const simp2 = douglasPeucker(part2, epsilon);

  const result: UtmCoord[] = simp1.slice(0, -1);
  for (let i = 0; i < simp2.length - 1; i++) {
    result.push(simp2[i]!);
  }
  return result;
}

function douglasPeucker(line: readonly UtmCoord[], epsilon: number): UtmCoord[] {
  if (line.length < 3) return line.slice();
  const start = line[0]!;
  const end = line[line.length - 1]!;

  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const d = perpendicularDistance(line[i]!, start, end);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(line.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(line.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [start, end];
}

function perpendicularDistance(p: UtmCoord, a: UtmCoord, b: UtmCoord): number {
  const dx = b.e - a.e;
  const dy = b.n - a.n;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.e - a.e, p.n - a.n);
  return Math.abs((p.e - a.e) * dy - (p.n - a.n) * dx) / len;
}

/**
 * True if `p` is inside `ring`, or within `tolerance` meters of its boundary
 * (tested by nudging `p` toward the polygon centroid by `tolerance` meters).
 */
export function pointInOrNearPolygon(
  p: UtmCoord,
  ring: readonly UtmCoord[],
  tolerance: number,
): boolean {
  if (pointInPolygon(p, ring)) return true;
  let cx = 0;
  let cy = 0;
  for (const v of ring) {
    cx += v.e;
    cy += v.n;
  }
  cx /= ring.length;
  cy /= ring.length;
  const dx = cx - p.e;
  const dy = cy - p.n;
  const len = Math.hypot(dx, dy) || 1;
  const nudged: UtmCoord = { e: p.e + (dx / len) * tolerance, n: p.n + (dy / len) * tolerance };
  return pointInPolygon(nudged, ring);
}

/**
 * Polygonizes the bank-connected cells that fall inside `blockRect`, returning
 * a (possibly stepped) closed polygon ring. Returns null if no cells inside
 * the rect are in the mask.
 */
export function clipBlockByBankMask(
  blockRect: Rectangle,
  bankMask: Uint8Array,
  water: WaterField,
  vectorize: (
    mask: Uint8Array,
    cols: number,
    rows: number,
    threshold: number,
    extent: GridExtent,
  ) => UtmCoord[][],
): UtmCoord[] | null {
  const { cols, rows, extent } = water;

  const startCol = Math.max(0, Math.floor((blockRect.minE - extent.minE) / extent.cellSize) - 1);
  const endCol = Math.min(cols - 1, Math.ceil((blockRect.maxE - extent.minE) / extent.cellSize) + 1);
  const startRow = Math.max(0, Math.floor((blockRect.minN - extent.minN) / extent.cellSize) - 1);
  const endRow = Math.min(rows - 1, Math.ceil((blockRect.maxN - extent.minN) / extent.cellSize) + 1);

  const subCols = endCol - startCol + 1;
  const subRows = endRow - startRow + 1;
  if (subCols < 2 || subRows < 2) return null;

  const subExtent: GridExtent = {
    cols: subCols,
    rows: subRows,
    cellSize: extent.cellSize,
    minE: extent.minE + startCol * extent.cellSize,
    minN: extent.minN + startRow * extent.cellSize,
    maxE: extent.minE + (endCol + 1) * extent.cellSize,
    maxN: extent.minN + (endRow + 1) * extent.cellSize,
  };

  const sub = new Uint8Array(subCols * subRows);
  let any = false;
  for (let r = 0; r < subRows; r++) {
    const globalR = startRow + r;
    for (let c = 0; c < subCols; c++) {
      const globalC = startCol + c;
      if (bankMask[globalR * cols + globalC] !== 1) continue;
      const cellCe = extent.minE + (globalC + 0.5) * extent.cellSize;
      const cellCn = extent.minN + (globalR + 0.5) * extent.cellSize;
      if (cellCe < blockRect.minE || cellCe > blockRect.maxE) continue;
      if (cellCn < blockRect.minN || cellCn > blockRect.maxN) continue;
      sub[r * subCols + c] = 1;
      any = true;
    }
  }
  if (!any) return null;

  const chains = vectorize(sub, subCols, subRows, 0.5, subExtent);
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
 * Clips a line segment against a (possibly non-convex) polygon. Returns the
 * sub-segments that lie inside the polygon.
 */
export function clipLineByPolygon(
  start: UtmCoord,
  end: UtmCoord,
  ring: readonly UtmCoord[],
): Array<[UtmCoord, UtmCoord]> {
  const ts: number[] = [0, 1];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const isect = segmentIntersect(start, end, a, b);
    if (!isect) continue;
    ts.push(isect.ta);
  }
  ts.sort((x, y) => x - y);

  const result: Array<[UtmCoord, UtmCoord]> = [];
  let cx = 0;
  let cy = 0;
  for (const r of ring) {
    cx += r.e;
    cy += r.n;
  }
  cx /= ring.length;
  cy /= ring.length;

  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < 1e-9) continue;
    const tm = (t0 + t1) / 2;
    const mid: UtmCoord = {
      e: start.e + tm * (end.e - start.e),
      n: start.n + tm * (end.n - start.n),
    };
    // Boundary-robust inclusion test: also test a point nudged toward the centroid.
    // This keeps lines that coincide with a polygon edge (treats them as inside).
    const dx = cx - mid.e;
    const dy = cy - mid.n;
    const len = Math.hypot(dx, dy) || 1;
    const nudged: UtmCoord = { e: mid.e + (dx / len) * 0.01, n: mid.n + (dy / len) * 0.01 };
    if (pointInPolygon(mid, ring) || pointInPolygon(nudged, ring)) {
      result.push([
        { e: start.e + t0 * (end.e - start.e), n: start.n + t0 * (end.n - start.n) },
        { e: start.e + t1 * (end.e - start.e), n: start.n + t1 * (end.n - start.n) },
      ]);
    }
  }
  return result;
}

/** Returns true if the cell containing `p` is dry (mask = 0). Out-of-bounds points are treated as dry. */
export function isPointDry(p: UtmCoord, water: WaterField): boolean {
  const col = Math.floor((p.e - water.extent.minE) / water.extent.cellSize);
  const row = Math.floor((p.n - water.extent.minN) / water.extent.cellSize);
  if (col < 0 || col >= water.cols || row < 0 || row >= water.rows) return true;
  return water.mask[row * water.cols + col] === 0;
}

/**
 * Walks a line segment in steps and returns dry sub-segments based on the
 * water-mask raster. Transitions between water and dry are sampled at
 * `stepMeters` resolution.
 */
export function clipLineByWaterMask(
  start: UtmCoord,
  end: UtmCoord,
  water: WaterField,
  stepMeters: number = 5,
): Array<[UtmCoord, UtmCoord]> {
  const len = Math.hypot(end.e - start.e, end.n - start.n);
  if (len < 1e-6) return [];
  const numSteps = Math.max(2, Math.ceil(len / stepMeters));
  const result: Array<[UtmCoord, UtmCoord]> = [];
  let segStart: UtmCoord | null = null;
  let prevPoint: UtmCoord = start;
  let prevDry = isPointDry(start, water);
  if (prevDry) segStart = start;
  for (let i = 1; i <= numSteps; i++) {
    const t = i / numSteps;
    const p: UtmCoord = {
      e: start.e + t * (end.e - start.e),
      n: start.n + t * (end.n - start.n),
    };
    const dry = isPointDry(p, water);
    if (dry && !prevDry) {
      segStart = p;
    } else if (!dry && prevDry && segStart !== null) {
      result.push([segStart, prevPoint]);
      segStart = null;
    }
    prevPoint = p;
    prevDry = dry;
  }
  if (segStart !== null && prevDry) {
    result.push([segStart, end]);
  }
  return result;
}
