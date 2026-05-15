import type { GridExtent, UtmCoord } from '../geo';

/**
 * Marching-squares case table.
 *
 * Bit layout for the 2x2 corner mask: bit0=v00 (col,row), bit1=v10 (col+1,row),
 * bit2=v11 (col+1,row+1), bit3=v01 (col,row+1).
 *
 * Each pair `[from, to]` is a directed segment whose travel direction keeps the
 * "above-threshold" region on its LEFT (CCW exterior of the filled region).
 *
 * Edge indices: 0=bottom, 1=right, 2=top, 3=left of the cell window.
 */
const CASES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  /*  0 */ [],
  /*  1 */ [[0, 3]],
  /*  2 */ [[1, 0]],
  /*  3 */ [[1, 3]],
  /*  4 */ [[2, 1]],
  /*  5 */ [
    [0, 3],
    [2, 1],
  ],
  /*  6 */ [[2, 0]],
  /*  7 */ [[2, 3]],
  /*  8 */ [[3, 2]],
  /*  9 */ [[0, 2]],
  /* 10 */ [
    [1, 0],
    [3, 2],
  ],
  /* 11 */ [[1, 2]],
  /* 12 */ [[3, 1]],
  /* 13 */ [[0, 1]],
  /* 14 */ [[3, 0]],
  /* 15 */ [],
];

type EdgeKey = number;

function hEdgeKey(col: number, row: number): EdgeKey {
  return (row * 0x8000 + col) * 2;
}
function vEdgeKey(col: number, row: number): EdgeKey {
  return (row * 0x8000 + col) * 2 + 1;
}

interface MSPoint {
  edge: EdgeKey;
  e: number;
  n: number;
}

interface MSSegment {
  a: MSPoint;
  b: MSPoint;
}

function edgePoint(
  edgeIdx: number,
  col: number,
  row: number,
  v00: number,
  v10: number,
  v11: number,
  v01: number,
  threshold: number,
  extent: GridExtent,
): MSPoint {
  const { minE, minN, cellSize } = extent;
  let gx = 0;
  let gy = 0;
  let edge: EdgeKey;
  switch (edgeIdx) {
    case 0: {
      const a = (threshold - v00) / (v10 - v00);
      gx = col + clamp01(a);
      gy = row;
      edge = hEdgeKey(col, row);
      break;
    }
    case 1: {
      const a = (threshold - v10) / (v11 - v10);
      gx = col + 1;
      gy = row + clamp01(a);
      edge = vEdgeKey(col + 1, row);
      break;
    }
    case 2: {
      const a = (threshold - v01) / (v11 - v01);
      gx = col + clamp01(a);
      gy = row + 1;
      edge = hEdgeKey(col, row + 1);
      break;
    }
    case 3: {
      const a = (threshold - v00) / (v01 - v00);
      gx = col;
      gy = row + clamp01(a);
      edge = vEdgeKey(col, row);
      break;
    }
    default:
      throw new Error(`bad edge index ${edgeIdx}`);
  }
  return { edge, e: minE + gx * cellSize, n: minN + gy * cellSize };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Marching-squares vectorization of a 2D scalar field at a given threshold.
 * The field is a row-major Float32Array; idx = row * cols + col.
 *
 * Returns chained UTM polylines. Closed rings have their first point repeated
 * as the last point.
 */
export function vectorizeIsoline(
  field: Float32Array | Uint8Array,
  cols: number,
  rows: number,
  threshold: number,
  extent: GridExtent,
): UtmCoord[][] {
  const segs: MSSegment[] = [];

  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const v00 = field[row * cols + col]!;
      const v10 = field[row * cols + col + 1]!;
      const v11 = field[(row + 1) * cols + col + 1]!;
      const v01 = field[(row + 1) * cols + col]!;
      const idx =
        (v00 >= threshold ? 1 : 0) |
        (v10 >= threshold ? 2 : 0) |
        (v11 >= threshold ? 4 : 0) |
        (v01 >= threshold ? 8 : 0);
      const pairs = CASES[idx]!;
      for (const [eA, eB] of pairs) {
        segs.push({
          a: edgePoint(eA, col, row, v00, v10, v11, v01, threshold, extent),
          b: edgePoint(eB, col, row, v00, v10, v11, v01, threshold, extent),
        });
      }
    }
  }

  return chainSegments(segs);
}

function chainSegments(segs: readonly MSSegment[]): UtmCoord[][] {
  const startMap = new Map<EdgeKey, MSSegment>();
  const endMap = new Map<EdgeKey, MSSegment>();
  for (const seg of segs) {
    startMap.set(seg.a.edge, seg);
    endMap.set(seg.b.edge, seg);
  }

  const visited = new Set<MSSegment>();
  const chains: UtmCoord[][] = [];

  for (const seg of segs) {
    if (visited.has(seg)) continue;
    visited.add(seg);

    const chain: UtmCoord[] = [
      { e: seg.a.e, n: seg.a.n },
      { e: seg.b.e, n: seg.b.n },
    ];

    let lastEdge = seg.b.edge;
    while (true) {
      const next = startMap.get(lastEdge);
      if (!next || visited.has(next)) break;
      visited.add(next);
      chain.push({ e: next.b.e, n: next.b.n });
      lastEdge = next.b.edge;
    }

    let firstEdge = seg.a.edge;
    while (true) {
      const prev = endMap.get(firstEdge);
      if (!prev || visited.has(prev)) break;
      visited.add(prev);
      chain.unshift({ e: prev.a.e, n: prev.a.n });
      firstEdge = prev.a.edge;
    }

    chains.push(chain);
  }

  return chains;
}

/**
 * Multi-level contour extraction. Returns one polyline list per threshold,
 * tagged with its elevation.
 */
export interface ContourLevel {
  elevation: number;
  lines: UtmCoord[][];
}

export function extractContours(
  field: Float32Array,
  cols: number,
  rows: number,
  extent: GridExtent,
  thresholds: readonly number[],
): ContourLevel[] {
  return thresholds.map((elevation) => ({
    elevation,
    lines: vectorizeIsoline(field, cols, rows, elevation, extent),
  }));
}

/**
 * Closed-ring water polygon extraction from a binary mask. Returns only chains
 * that close (start point equals end point).
 */
export function extractWaterPolygons(
  mask: Uint8Array,
  cols: number,
  rows: number,
  extent: GridExtent,
): UtmCoord[][] {
  // Force border cells to 0 so a river that touches the grid edge still
  // produces a closed polygon (closes against the boundary).
  const bordered = new Uint8Array(mask);
  for (let c = 0; c < cols; c++) {
    bordered[c] = 0;
    bordered[(rows - 1) * cols + c] = 0;
  }
  for (let r = 0; r < rows; r++) {
    bordered[r * cols] = 0;
    bordered[r * cols + (cols - 1)] = 0;
  }

  const chains = vectorizeIsoline(bordered, cols, rows, 0.5, extent);
  return chains.filter((c) => {
    if (c.length < 4) return false;
    const first = c[0]!;
    const last = c[c.length - 1]!;
    return first.e === last.e && first.n === last.n;
  });
}
