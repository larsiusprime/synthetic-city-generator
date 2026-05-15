import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { gridExtentCornersLonLat, makeFrame } from './core/geo';
import { downtownToGeoJson, ghostGridToGeoJson } from './core/io/geojson';
import { TerrainLayer } from './render/terrain-layer';
import { Sidebar } from './ui/sidebar';
import { buildExportZip, triggerDownload } from './ui/export';
import { generate as generateInWorker } from './worker/client';
import type { GenerateResponse } from './worker/protocol';

const DEFAULT_LON_LAT: [number, number] = [-94.5786, 39.0997];
const TERRAIN_LAYER_ID = 'hjemby-terrain';
const GRID_SOURCE_ID = 'hjemby-grid';
const GRID_SECTION_LAYER_ID = 'hjemby-grid-section';
const GRID_TOWNSHIP_LAYER_ID = 'hjemby-grid-township';
const DOWNTOWN_SOURCE_ID = 'hjemby-downtown';
const DOWNTOWN_LAYER_ID = 'hjemby-downtown';

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0e0e0e' },
      },
    ],
  },
  center: DEFAULT_LON_LAT,
  zoom: 11,
  attributionControl: false,
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

let latestResponse: GenerateResponse | null = null;

function whenStyleLoaded(): Promise<void> {
  if (map.isStyleLoaded()) return Promise.resolve();
  return new Promise<void>((resolve) => map.once('styledata', () => resolve()));
}

const sidebar = new Sidebar(document.getElementById('panel-root')!, {
  onGenerate: async (params) => {
    const t0 = performance.now();
    const response = await generateInWorker({
      seed: params.seed,
      anchor: params.anchor,
      config: { cols: 512, rows: 512, cellSize: 10, includeRiver: params.includeRiver },
    });
    const tGen = performance.now() - t0;

    await whenStyleLoaded();
    latestResponse = response;
    installLayer(response);
    installOverlays(response);
    flyToExtent(response);

    const riverNote = response.river
      ? `river: ${response.river.bluffSide ? response.river.bluffSide + '-bank bluff' : 'symmetric'}`
      : 'no river';
    sidebar.setStatus(
      `Done in ${tGen.toFixed(0)} ms · ${response.config.cols}×${response.config.rows} @ ${response.config.cellSize}m · ${response.minHeight.toFixed(1)}-${response.maxHeight.toFixed(1)} m · ${riverNote}`,
      'ok',
    );
    sidebar.setExportReady(true);
  },
  onExport: async () => {
    if (!latestResponse) return;
    sidebar.setStatus('Packing export…', 'busy');
    try {
      const zip = buildExportZip(latestResponse);
      const filename = `hjemby-${latestResponse.seed}.zip`;
      triggerDownload(zip, filename);
      sidebar.setStatus(`Exported ${filename}.`, 'ok');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sidebar.setStatus(`Export failed: ${msg}`, 'error');
    }
  },
  onToggleOverlay: (kind, visible) => {
    setOverlayVisibility(kind, visible);
  },
});

function installLayer(response: GenerateResponse): void {
  const frame = makeFrame(response.anchor);
  const extent = {
    cols: response.config.cols,
    rows: response.config.rows,
    cellSize: response.extent.cellSize,
    minE: response.extent.minE,
    minN: response.extent.minN,
    maxE: response.extent.maxE,
    maxN: response.extent.maxN,
  };
  const cornersLL = gridExtentCornersLonLat(frame, extent);
  const corners: [number, number][] = cornersLL.map((p) => [p.lon, p.lat]);

  const heights = new Float32Array(response.heightsBuf);
  const layer = new TerrainLayer({
    heights,
    cols: response.config.cols,
    rows: response.config.rows,
    cellSize: response.config.cellSize,
    minHeight: response.minHeight,
    maxHeight: response.maxHeight,
    seaLevel: response.seaLevel,
    cornersLonLat: corners,
    verticalExaggeration: 1.5,
  });

  if (map.getLayer(TERRAIN_LAYER_ID)) {
    map.removeLayer(TERRAIN_LAYER_ID);
  }
  map.addLayer(layer);
  map.triggerRepaint();
}

function installOverlays(response: GenerateResponse): void {
  const frame = makeFrame(response.anchor);
  const gridFc = ghostGridToGeoJson(frame, response.grid);
  const downtownFc = downtownToGeoJson(frame, response.downtown);

  const gridSource = map.getSource(GRID_SOURCE_ID);
  if (gridSource && gridSource.type === 'geojson') {
    (gridSource as maplibregl.GeoJSONSource).setData(gridFc as never);
  } else {
    map.addSource(GRID_SOURCE_ID, { type: 'geojson', data: gridFc as never });
  }

  if (!map.getLayer(GRID_SECTION_LAYER_ID)) {
    map.addLayer({
      id: GRID_SECTION_LAYER_ID,
      type: 'line',
      source: GRID_SOURCE_ID,
      filter: ['==', ['get', 'tier'], 'section'],
      paint: {
        'line-color': '#d6c79a',
        'line-width': 0.6,
        'line-opacity': 0.7,
      },
    });
  }
  if (!map.getLayer(GRID_TOWNSHIP_LAYER_ID)) {
    map.addLayer({
      id: GRID_TOWNSHIP_LAYER_ID,
      type: 'line',
      source: GRID_SOURCE_ID,
      filter: ['==', ['get', 'tier'], 'township'],
      paint: {
        'line-color': '#f1d885',
        'line-width': 1.8,
        'line-opacity': 0.9,
      },
    });
  }

  const downtownSource = map.getSource(DOWNTOWN_SOURCE_ID);
  if (downtownSource && downtownSource.type === 'geojson') {
    (downtownSource as maplibregl.GeoJSONSource).setData(downtownFc as never);
  } else {
    map.addSource(DOWNTOWN_SOURCE_ID, { type: 'geojson', data: downtownFc as never });
  }
  if (!map.getLayer(DOWNTOWN_LAYER_ID)) {
    map.addLayer({
      id: DOWNTOWN_LAYER_ID,
      type: 'circle',
      source: DOWNTOWN_SOURCE_ID,
      paint: {
        'circle-radius': 7,
        'circle-color': '#ffd860',
        'circle-stroke-color': '#1a1a1a',
        'circle-stroke-width': 1.5,
      },
    });
  }
}

export function setOverlayVisibility(kind: 'grid' | 'downtown', visible: boolean): void {
  const value = visible ? 'visible' : 'none';
  if (kind === 'grid') {
    if (map.getLayer(GRID_SECTION_LAYER_ID)) map.setLayoutProperty(GRID_SECTION_LAYER_ID, 'visibility', value);
    if (map.getLayer(GRID_TOWNSHIP_LAYER_ID)) map.setLayoutProperty(GRID_TOWNSHIP_LAYER_ID, 'visibility', value);
  } else if (map.getLayer(DOWNTOWN_LAYER_ID)) {
    map.setLayoutProperty(DOWNTOWN_LAYER_ID, 'visibility', value);
  }
}

function flyToExtent(response: GenerateResponse): void {
  const frame = makeFrame(response.anchor);
  const corners = gridExtentCornersLonLat(frame, {
    cols: response.config.cols,
    rows: response.config.rows,
    cellSize: response.extent.cellSize,
    minE: response.extent.minE,
    minN: response.extent.minN,
    maxE: response.extent.maxE,
    maxN: response.extent.maxN,
  });
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const c of corners) {
    if (c.lon < minLon) minLon = c.lon;
    if (c.lon > maxLon) maxLon = c.lon;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
  }
  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    { padding: 40, duration: 600 },
  );
}

