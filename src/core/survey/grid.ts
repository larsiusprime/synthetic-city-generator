import type { GeoFrame, GridExtent, UtmCoord } from '../geo';

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
 * The frame's anchor sits exactly at the (0, 0) section corner; lines extend
 * outward in all four directions at one-mile spacing. Every sixth line in
 * each direction is tagged as a township boundary.
 */
export function generateGhostGrid(frame: GeoFrame, extent: GridExtent): GhostGrid {
  const origin: UtmCoord = { e: frame.anchorE, n: frame.anchorN };
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
