import type { UtmCoord } from '../geo';
import type { DowntownAnchor } from './downtown';
import { STREET_GRID_DIVISIONS } from './streets';
import type { Townsite } from './townsite';

export interface Block {
  /** Column index 0..divisions-1 (west to east). */
  col: number;
  /** Row index 0..divisions-1 (south to north). */
  row: number;
  sw: UtmCoord;
  se: UtmCoord;
  ne: UtmCoord;
  nw: UtmCoord;
  /** True if this block is the designated public square (e.g., courthouse / town green). */
  publicSquare: boolean;
}

/**
 * Builds the rectangular blocks tiled by the street grid. Designates the
 * block whose center is closest to the downtown anchor as the public square
 * (tiebreak prefers the more northeast block).
 */
export function buildBlocks(townsite: Townsite, downtown: DowntownAnchor): Block[] {
  const divisions = STREET_GRID_DIVISIONS;
  const side = townsite.sideMeters;
  const step = side / divisions;
  const minE = townsite.sw.e;
  const minN = townsite.sw.n;

  const blocks: Block[] = [];
  for (let row = 0; row < divisions; row++) {
    for (let col = 0; col < divisions; col++) {
      const e0 = minE + col * step;
      const n0 = minN + row * step;
      blocks.push({
        col,
        row,
        sw: { e: e0, n: n0 },
        se: { e: e0 + step, n: n0 },
        ne: { e: e0 + step, n: n0 + step },
        nw: { e: e0, n: n0 + step },
        publicSquare: false,
      });
    }
  }

  const a = downtown.utm;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const cx = (b.sw.e + b.ne.e) / 2;
    const cy = (b.sw.n + b.ne.n) / 2;
    const dx = cx - a.e;
    const dy = cy - a.n;
    const d = dx * dx + dy * dy;
    if (d < bestDist - 1e-6) {
      bestDist = d;
      bestIdx = i;
    } else if (Math.abs(d - bestDist) < 1e-6) {
      const current = blocks[bestIdx]!;
      if (b.col > current.col || (b.col === current.col && b.row > current.row)) {
        bestIdx = i;
      }
    }
  }
  blocks[bestIdx]!.publicSquare = true;

  return blocks;
}
