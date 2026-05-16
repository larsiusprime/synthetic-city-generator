import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { gridExtentCornersLonLat, makeFrame } from './core/geo';
import {
  blocksToGeoJson,
  downtownToGeoJson,
  ghostGridToGeoJson,
  streetGridToGeoJson,
  townsiteToGeoJson,
} from './core/io/geojson';
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
const TOWNSITE_SOURCE_ID = 'hjemby-townsite';
const TOWNSITE_FILL_LAYER_ID = 'hjemby-townsite-fill';
const TOWNSITE_LINE_LAYER_ID = 'hjemby-townsite-line';
const STREETS_SOURCE_ID = 'hjemby-streets';
const STREETS_LAYER_ID = 'hjemby-streets';
const BLOCKS_SOURCE_ID = 'hjemby-blocks';
const BLOCKS_FILL_LAYER_ID = 'hjemby-blocks-fill';
const BLOCKS_LINE_LAYER_ID = 'hjemby-blocks-line';
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
      config: { cols: 512, rows: 512, cellSize: 10, water: params.water },
    });
    const tGen = performance.now() - t0;

    await whenStyleLoaded();
    latestResponse = response;
    installLayer(response);
    installOverlays(response);
    flyToExtent(response);

    const waterNote =
      response.config.water === 'none'
        ? 'no water'
        : response.river
          ? `${response.config.water}: ${response.river.bluffSide ? response.river.bluffSide + '-bank bluff' : 'symmetric'}`
          : response.config.water;
    sidebar.setStatus(
      `Done in ${tGen.toFixed(0)} ms · ${response.config.cols}×${response.config.rows} @ ${response.config.cellSize}m · ${response.minHeight.toFixed(1)}-${response.maxHeight.toFixed(1)} m · ${waterNote}`,
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
  // On regenerate, the overlays already exist and the freshly-added terrain
  // sits on top of them. Slide it back beneath the first overlay so they stay
  // visible.
  if (map.getLayer(GRID_SECTION_LAYER_ID)) {
    map.moveLayer(TERRAIN_LAYER_ID, GRID_SECTION_LAYER_ID);
  }
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

  const townsiteFc = townsiteToGeoJson(frame, response.townsite);
  const townsiteSource = map.getSource(TOWNSITE_SOURCE_ID);
  if (townsiteSource && townsiteSource.type === 'geojson') {
    (townsiteSource as maplibregl.GeoJSONSource).setData(townsiteFc as never);
  } else {
    map.addSource(TOWNSITE_SOURCE_ID, { type: 'geojson', data: townsiteFc as never });
  }
  if (!map.getLayer(TOWNSITE_FILL_LAYER_ID)) {
    map.addLayer({
      id: TOWNSITE_FILL_LAYER_ID,
      type: 'fill',
      source: TOWNSITE_SOURCE_ID,
      paint: {
        'fill-color': '#ffd860',
        'fill-opacity': 0.08,
      },
    });
  }
  if (!map.getLayer(TOWNSITE_LINE_LAYER_ID)) {
    map.addLayer({
      id: TOWNSITE_LINE_LAYER_ID,
      type: 'line',
      source: TOWNSITE_SOURCE_ID,
      paint: {
        'line-color': '#ffd860',
        'line-width': 2,
        'line-opacity': 0.9,
      },
    });
  }

  const blocksFc = blocksToGeoJson(frame, response.blocks);
  const blocksSource = map.getSource(BLOCKS_SOURCE_ID);
  if (blocksSource && blocksSource.type === 'geojson') {
    (blocksSource as maplibregl.GeoJSONSource).setData(blocksFc as never);
  } else {
    map.addSource(BLOCKS_SOURCE_ID, { type: 'geojson', data: blocksFc as never });
  }
  if (!map.getLayer(BLOCKS_FILL_LAYER_ID)) {
    map.addLayer({
      id: BLOCKS_FILL_LAYER_ID,
      type: 'fill',
      source: BLOCKS_SOURCE_ID,
      paint: {
        'fill-color': ['case', ['==', ['get', 'public_square'], true], '#5e7e4a', '#3a3024'],
        'fill-opacity': ['case', ['==', ['get', 'public_square'], true], 0.45, 0.25],
      },
    });
  }
  if (!map.getLayer(BLOCKS_LINE_LAYER_ID)) {
    map.addLayer({
      id: BLOCKS_LINE_LAYER_ID,
      type: 'line',
      source: BLOCKS_SOURCE_ID,
      paint: {
        'line-color': '#6b5a44',
        'line-width': 0.8,
        'line-opacity': 0.7,
      },
    });
  }

  const streetsFc = streetGridToGeoJson(frame, response.streetGrid);
  const streetsSource = map.getSource(STREETS_SOURCE_ID);
  if (streetsSource && streetsSource.type === 'geojson') {
    (streetsSource as maplibregl.GeoJSONSource).setData(streetsFc as never);
  } else {
    map.addSource(STREETS_SOURCE_ID, { type: 'geojson', data: streetsFc as never });
  }
  if (!map.getLayer(STREETS_LAYER_ID)) {
    map.addLayer({
      id: STREETS_LAYER_ID,
      type: 'line',
      source: STREETS_SOURCE_ID,
      paint: {
        'line-color': '#f4efe2',
        'line-width': 2,
        'line-opacity': 0.95,
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

export function setOverlayVisibility(
  kind: 'grid' | 'downtown' | 'townsite' | 'streets' | 'blocks',
  visible: boolean,
): void {
  const value = visible ? 'visible' : 'none';
  const layers: string[] =
    kind === 'grid'
      ? [GRID_SECTION_LAYER_ID, GRID_TOWNSHIP_LAYER_ID]
      : kind === 'townsite'
        ? [TOWNSITE_FILL_LAYER_ID, TOWNSITE_LINE_LAYER_ID]
        : kind === 'streets'
          ? [STREETS_LAYER_ID]
          : kind === 'blocks'
            ? [BLOCKS_FILL_LAYER_ID, BLOCKS_LINE_LAYER_ID]
            : [DOWNTOWN_LAYER_ID];
  for (const id of layers) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', value);
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

