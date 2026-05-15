import type { LonLat } from '../core/geo';
import type { TerrainConfig } from '../core/terrain';
import type { GenerateResponse, WorkerOutbound } from './protocol';

interface PendingRequest {
  resolve: (result: GenerateResponse) => void;
  reject: (err: Error) => void;
}

let nextId = 1;
const pending = new Map<number, PendingRequest>();

const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });

worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => {
  const msg = ev.data;
  const req = pending.get(msg.id);
  if (!req) return;
  pending.delete(msg.id);
  if (msg.type === 'error') {
    req.reject(new Error(msg.message));
  } else {
    req.resolve(msg);
  }
};

worker.onerror = (ev: ErrorEvent) => {
  for (const req of pending.values()) {
    req.reject(new Error(ev.message || 'worker error'));
  }
  pending.clear();
};

export interface GenerateOptions {
  seed: number;
  anchor: LonLat;
  config: TerrainConfig;
}

export function generate(options: GenerateOptions): Promise<GenerateResponse> {
  const id = nextId++;
  return new Promise<GenerateResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type: 'generate', ...options });
  });
}
