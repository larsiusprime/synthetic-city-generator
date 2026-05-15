/// <reference lib="WebWorker" />

import { makeFrame } from '../core/geo';
import { Prng } from '../core/prng';
import { generateTerrain } from '../core/terrain';
import { extractContours, extractWaterPolygons } from '../core/terrain/vectorize';
import type { GenerateRequest, GenerateResponse, WorkerOutbound } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<GenerateRequest>) => {
  const req = ev.data;
  try {
    if (req.type !== 'generate') return;
    const response = run(req);
    const transfer: Transferable[] = [response.heightsBuf, response.waterMaskBuf];
    ctx.postMessage(response, transfer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failure: WorkerOutbound = { id: req.id, type: 'error', message };
    ctx.postMessage(failure);
  }
};

function run(req: GenerateRequest): GenerateResponse {
  const prng = new Prng(req.seed);
  const frame = makeFrame(req.anchor);
  const terrain = generateTerrain(prng, frame, req.config);

  const step = 5;
  const floor = Math.floor(terrain.minHeight / step) * step;
  const ceil = Math.ceil(terrain.maxHeight / step) * step;
  const thresholds: number[] = [];
  for (let h = floor; h <= ceil; h += step) thresholds.push(h);

  const contours = extractContours(
    terrain.heights,
    req.config.cols,
    req.config.rows,
    terrain.extent,
    thresholds,
  );
  const waterPolygons = extractWaterPolygons(
    terrain.waterMask,
    req.config.cols,
    req.config.rows,
    terrain.extent,
  );

  return {
    id: req.id,
    type: 'result',
    seed: req.seed,
    anchor: req.anchor,
    config: req.config,
    zoneEpsg: frame.zone.epsg,
    extent: {
      cols: req.config.cols,
      rows: req.config.rows,
      cellSize: terrain.extent.cellSize,
      minE: terrain.extent.minE,
      minN: terrain.extent.minN,
      maxE: terrain.extent.maxE,
      maxN: terrain.extent.maxN,
    },
    heightsBuf: terrain.heights.buffer as ArrayBuffer,
    waterMaskBuf: terrain.waterMask.buffer as ArrayBuffer,
    minHeight: terrain.minHeight,
    maxHeight: terrain.maxHeight,
    seaLevel: terrain.seaLevel,
    river: terrain.river,
    contours,
    waterPolygons,
  };
}
