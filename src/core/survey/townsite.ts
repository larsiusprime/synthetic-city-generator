import type { UtmCoord } from '../geo';
import type { RiverPath } from '../terrain';
import type { DowntownAnchor } from './downtown';
import { SECTION_METERS } from './grid';

/** Side length of a quarter-section townsite, in meters (= ½ mile). */
export const TOWNSITE_SIDE_METERS = SECTION_METERS / 2;

export type TownsiteBank = 'north' | 'south' | 'east' | 'west';

export interface Townsite {
  /** Geometric center of the townsite (NOT the same as the downtown anchor when shifted). */
  center: UtmCoord;
  sw: UtmCoord;
  se: UtmCoord;
  ne: UtmCoord;
  nw: UtmCoord;
  /** Side length in meters (square, cardinal-aligned). */
  sideMeters: number;
  /**
   * For a river city, the bank the townsite sits on — the anchor sits at the
   * midpoint of the riverfront edge. For a riverless city, null and the
   * anchor sits at the geometric center.
   */
  bank: TownsiteBank | null;
}

/**
 * Quarter-section (½ mi × ½ mi = 160 acres) cardinal-aligned polygon.
 *
 * For a river city the townsite sits predominantly on one bank: the downtown
 * anchor lies at the midpoint of the riverfront edge, and the townsite
 * extends inland from there. For a riverless city the townsite is centered
 * on the anchor.
 */
export function buildTownsite(downtown: DowntownAnchor, bank: TownsiteBank | null): Townsite {
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

  return {
    center,
    sw: { e: center.e - half, n: center.n - half },
    se: { e: center.e + half, n: center.n - half },
    ne: { e: center.e + half, n: center.n + half },
    nw: { e: center.e - half, n: center.n + half },
    sideMeters: TOWNSITE_SIDE_METERS,
    bank,
  };
}

/**
 * Maps a river's flow direction + bluff side onto a cardinal bank.
 * "Left" is to the left of the flow direction (standard math convention).
 *
 * - Horizontal river (flows west → east): left = north, right = south.
 * - Vertical river (flows south → north): left = west, right = east.
 */
export function bankFromRiver(horizontal: boolean, riverSide: 'left' | 'right'): TownsiteBank {
  if (horizontal) {
    return riverSide === 'left' ? 'north' : 'south';
  }
  return riverSide === 'left' ? 'west' : 'east';
}

/** Convenience: picks the bank for a given river. Coin is required when no bluff exists. */
export function pickTownsiteBank(river: RiverPath | null, coinForRiverWithoutBluff: boolean): TownsiteBank | null {
  if (river === null) return null;
  if (river.bluffSide !== null) return bankFromRiver(river.horizontal, river.bluffSide);
  return bankFromRiver(river.horizontal, coinForRiverWithoutBluff ? 'left' : 'right');
}
