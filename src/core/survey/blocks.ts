import type { UtmCoord } from '../geo';
import { intersectPolygons } from './poly-ops';
import { STREET_GRID_DIVISIONS, STREET_WIDTH_METERS } from './streets';
import type { Townsite } from './townsite';

export type BlockKind = 'public-square' | 'school' | 'commercial' | 'residential';

export interface Block {
  col: number;
  row: number;
  /** Closed CCW polygon ring (intersection of the inset block rectangle with the township ring, optionally water-clipped). */
  ring: UtmCoord[];
  kind: BlockKind;
}

/** Side length of a single block in meters (= townsite side / divisions). */
export function blockStep(townsite: Townsite): number {
  return townsite.sideMeters / STREET_GRID_DIVISIONS;
}

/** Full-block area after street-ROW inset, in square meters. */
export function fullInsetBlockArea(townsite: Townsite): number {
  const s = blockStep(townsite) - STREET_WIDTH_METERS;
  return s * s;
}

/**
 * Tiles the unclipped township rectangle into a `divisions × divisions` grid,
 * insets each block rectangle by half the street ROW on all sides, and
 * intersects with the township polygon. Returns blocks with geometry only;
 * `kind` is initialized to 'residential' as a placeholder and must be
 * overwritten by the classification step in `buildParcels`.
 */
export function buildBlocks(townsite: Townsite): Block[] {
  const divisions = STREET_GRID_DIVISIONS;
  const step = blockStep(townsite);
  const minE = townsite.unclippedCenter.e - townsite.sideMeters / 2;
  const minN = townsite.unclippedCenter.n - townsite.sideMeters / 2;
  const inset = STREET_WIDTH_METERS / 2;

  const blocks: Block[] = [];
  for (let row = 0; row < divisions; row++) {
    for (let col = 0; col < divisions; col++) {
      const e0 = minE + col * step + inset;
      const e1 = minE + (col + 1) * step - inset;
      const n0 = minN + row * step + inset;
      const n1 = minN + (row + 1) * step - inset;
      const rectRing: UtmCoord[] = [
        { e: e0, n: n0 },
        { e: e1, n: n0 },
        { e: e1, n: n1 },
        { e: e0, n: n1 },
      ];
      const ring = intersectPolygons(rectRing, townsite.ring);
      if (ring === null) continue;
      blocks.push({ col, row, ring, kind: 'residential' });
    }
  }
  return blocks;
}

/** Returns the inset rectangle bounds of a block (street ROW removed,
 * before township clipping). Used by parcel layout so lots align with
 * the block edge rather than the street centerline. */
export function blockRect(townsite: Townsite, col: number, row: number): {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
} {
  const step = blockStep(townsite);
  const inset = STREET_WIDTH_METERS / 2;
  const e0 = townsite.unclippedCenter.e - townsite.sideMeters / 2 + col * step + inset;
  const n0 = townsite.unclippedCenter.n - townsite.sideMeters / 2 + row * step + inset;
  return { minE: e0, maxE: e0 + (step - 2 * inset), minN: n0, maxN: n0 + (step - 2 * inset) };
}
