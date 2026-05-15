import type { LonLat, UtmCoord } from '../core/geo';
import type { TerrainConfig, RiverSide } from '../core/terrain';
import type { GhostGrid, DowntownAnchor, Townsite, Street } from '../core/survey';

export interface GenerateRequest {
  id: number;
  type: 'generate';
  seed: number;
  anchor: LonLat;
  config: TerrainConfig;
}

export interface GridExtentMessage {
  cols: number;
  rows: number;
  cellSize: number;
  minE: number;
  minN: number;
  maxE: number;
  maxN: number;
}

export interface RiverMessage {
  points: UtmCoord[];
  horizontal: boolean;
  bluffSide: RiverSide | null;
}

export interface ContourLevelMessage {
  elevation: number;
  lines: UtmCoord[][];
}

export interface GenerateResponse {
  id: number;
  type: 'result';
  seed: number;
  anchor: LonLat;
  config: TerrainConfig;
  zoneEpsg: number;
  extent: GridExtentMessage;
  heightsBuf: ArrayBuffer;
  waterMaskBuf: ArrayBuffer;
  minHeight: number;
  maxHeight: number;
  seaLevel: number;
  river: RiverMessage | null;
  contours: ContourLevelMessage[];
  waterPolygons: UtmCoord[][];
  grid: GhostGrid;
  downtown: DowntownAnchor;
  townsite: Townsite;
  streets: Street[];
}

export interface ErrorResponse {
  id: number;
  type: 'error';
  message: string;
}

export type WorkerOutbound = GenerateResponse | ErrorResponse;
