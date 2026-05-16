import type { Prng } from '../prng';
import type { GridExtent, UtmCoord } from '../geo';

export type RiverSide = 'left' | 'right';

export interface RiverPath {
  /** Polyline samples in local UTM meters, ordered along the flow direction. */
  points: UtmCoord[];
  /** True if the river runs roughly east-west; false if north-south. */
  horizontal: boolean;
  /** Which side bears a bluff/cut bank, or null for a symmetric / flat-coast case. Independent of citySide. */
  bluffSide: RiverSide | null;
  /**
   * Which side the city sits on. For river mode this is the dry/preferred bank;
   * for shore mode this is the land side (the opposite side is water). Always
   * set: if a bluff exists, citySide = bluffSide; otherwise it's an independent coin flip.
   */
  citySide: RiverSide;
  /**
   * Whether this polyline represents a river centerline (water on both sides)
   * or a shoreline (water on the non-citySide). Drives terrain shaping and the
   * townsite setback: river/shore-with-beach get a ~100 m corridor pulled back
   * from the centerline; shore-with-bluff gets just a small clifftop setback.
   */
  kind: 'river' | 'shore';
}

const BLUFF_PROBABILITY = 0.5;

export function generateRiver(prng: Prng, extent: GridExtent, kind: 'river' | 'shore'): RiverPath {
  const horizontal = prng.bool();
  const width = extent.maxE - extent.minE;
  const height = extent.maxN - extent.minN;
  const alongLength = horizontal ? width : height;

  const startCrossFrac = prng.range(0.35, 0.65);
  const endCrossFrac = prng.range(0.35, 0.65);

  const meanderAmpFrac = prng.range(0.1, 0.18);
  const meanderCycles = prng.range(1.2, 2.4);
  const meanderPhase = prng.range(0, Math.PI * 2);

  const subMeanderAmpFrac = meanderAmpFrac * 0.3;
  const subMeanderCycles = meanderCycles * 4;
  const subMeanderPhase = prng.range(0, Math.PI * 2);

  const steps = Math.max(200, Math.floor(alongLength / 20));
  const points: UtmCoord[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const baseCross = startCrossFrac + (endCrossFrac - startCrossFrac) * t;
    const meander =
      Math.sin(t * meanderCycles * Math.PI * 2 + meanderPhase) * meanderAmpFrac +
      Math.sin(t * subMeanderCycles * Math.PI * 2 + subMeanderPhase) * subMeanderAmpFrac;
    const crossFrac = Math.min(0.95, Math.max(0.05, baseCross + meander));

    if (horizontal) {
      const e = extent.minE + t * width;
      const n = extent.minN + crossFrac * height;
      points.push({ e, n });
    } else {
      const e = extent.minE + crossFrac * width;
      const n = extent.minN + t * height;
      points.push({ e, n });
    }
  }

  const bluffSide: RiverSide | null = prng.bool(BLUFF_PROBABILITY)
    ? prng.bool() ? 'left' : 'right'
    : null;
  const citySide: RiverSide = bluffSide ?? (prng.bool() ? 'left' : 'right');
  return { points, horizontal, bluffSide, citySide, kind };
}

export interface PolylineDistance {
  /** Euclidean distance to the closest point on the polyline (meters). */
  dist: number;
  /**
   * Signed perpendicular indicator for the closest segment:
   * positive = left of flow direction, negative = right.
   */
  side: number;
}

export function distanceToPolyline(px: number, py: number, points: readonly UtmCoord[]): PolylineDistance {
  let minDist = Infinity;
  let sideAtMin = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.e - a.e;
    const dy = b.n - a.n;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = ((px - a.e) * dx + (py - a.n) * dy) / lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const cx = a.e + t * dx;
    const cy = a.n + t * dy;
    const ddx = px - cx;
    const ddy = py - cy;
    const d = Math.sqrt(ddx * ddx + ddy * ddy);
    if (d < minDist) {
      minDist = d;
      sideAtMin = dx * (py - a.n) - dy * (px - a.e);
    }
  }
  return { dist: minDist, side: sideAtMin };
}
