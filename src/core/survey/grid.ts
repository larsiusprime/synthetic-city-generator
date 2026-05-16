import type { GeoFrame, GridExtent, UtmCoord } from '../geo';
import type { DowntownAnchor } from './downtown';

export const SECTION_METERS = 1609.344;
export const SECTIONS_PER_TOWNSHIP = 6;

export type GridLineTier = 'section' | 'township';

export interface GridLine {
  tier: GridLineTier;
  /** Direction the line runs: 'meridian' = north-south, 'parallel' = east-west. */
  direction: 'meridian' | 'parallel';
  /** Signed index from the anchor: 0 is the anchor's line, +1 is one mile east/north, -2 is two miles west/south. */
  index: number;
  a: UtmCoord;
  b: UtmCoord;
}

export interface GhostGrid {
  /** UTM corner of the anchor section (0, 0). */
  origin: UtmCoord;
  lines: GridLine[];
}

/**
 * Generates a cardinal-aligned PLS section grid clipped to the terrain extent.
 * By default the frame's anchor sits at the (0, 0) section corner. Pass
 * `originOverride` (typically derived via `computeGridOrigin`) to shift one or
 * both axes so the grid lines up with a chosen reference point — usually the
 * downtown anchor, so the townsite's water-facing edge falls exactly on a
 * section line.
 */
export function generateGhostGrid(
  frame: GeoFrame,
  extent: GridExtent,
  originOverride?: UtmCoord,
): GhostGrid {
  const origin: UtmCoord = originOverride ?? { e: frame.anchorE, n: frame.anchorN };
  const lines: GridLine[] = [];

  const minIE = Math.ceil((extent.minE - origin.e) / SECTION_METERS);
  const maxIE = Math.floor((extent.maxE - origin.e) / SECTION_METERS);
  for (let i = minIE; i <= maxIE; i++) {
    const e = origin.e + i * SECTION_METERS;
    lines.push({
      tier: i % SECTIONS_PER_TOWNSHIP === 0 ? 'township' : 'section',
      direction: 'meridian',
      index: i,
      a: { e, n: extent.minN },
      b: { e, n: extent.maxN },
    });
  }

  const minIN = Math.ceil((extent.minN - origin.n) / SECTION_METERS);
  const maxIN = Math.floor((extent.maxN - origin.n) / SECTION_METERS);
  for (let i = minIN; i <= maxIN; i++) {
    const n = origin.n + i * SECTION_METERS;
    lines.push({
      tier: i % SECTIONS_PER_TOWNSHIP === 0 ? 'township' : 'section',
      direction: 'parallel',
      index: i,
      a: { e: extent.minE, n },
      b: { e: extent.maxE, n },
    });
  }

  return { origin, lines };
}

/**
 * Picks a grid origin such that the downtown anchor lands on a section corner
 * of the resulting grid. The downtown anchor lies on a section line of the
 * default (frame-anchored) grid in one axis; the perpendicular axis is shifted
 * to also pass through the anchor. For riverless cities (anchor already at a
 * section corner) this returns the frame anchor unchanged.
 */
export function computeGridOrigin(downtown: DowntownAnchor, frame: GeoFrame): UtmCoord {
  const eRel = (downtown.utm.e - frame.anchorE) / SECTION_METERS;
  const nRel = (downtown.utm.n - frame.anchorN) / SECTION_METERS;
  const onMeridian = Math.abs(eRel - Math.round(eRel)) < 1e-4;
  const onParallel = Math.abs(nRel - Math.round(nRel)) < 1e-4;
  return {
    e: onMeridian ? frame.anchorE : downtown.utm.e,
    n: onParallel ? frame.anchorN : downtown.utm.n,
  };
}
