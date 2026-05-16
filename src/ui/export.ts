import { zipSync } from 'fflate';
import { centeredGridExtent, makeFrame } from '../core/geo';
import {
  blocksToGeoJson,
  contoursToGeoJson,
  downtownToGeoJson,
  extentToGeoJson,
  ghostGridToGeoJson,
  parcelsToGeoJson,
  streetGridToGeoJson,
  stringify,
  terrainToGeoTiff,
  townsiteToGeoJson,
  waterPolygonsToGeoJson,
} from '../core/io';
import type { GenerateResponse } from '../worker/protocol';

export function buildExportZip(response: GenerateResponse): Uint8Array {
  const frame = makeFrame(response.anchor);
  const { cols, rows, cellSize } = response.config;
  const extent = centeredGridExtent(frame, cols, rows, cellSize);
  const heights = new Float32Array(response.heightsBuf);

  const extentGeoJson = extentToGeoJson(frame, extent);
  const waterGeoJson = waterPolygonsToGeoJson(frame, response.waterPolygons);
  const contoursGeoJson = contoursToGeoJson(frame, response.contours);
  const gridGeoJson = ghostGridToGeoJson(frame, response.grid);
  const downtownGeoJson = downtownToGeoJson(frame, response.downtown);
  const townsiteGeoJson = townsiteToGeoJson(frame, response.townsite);
  const streetsGeoJson = streetGridToGeoJson(frame, response.streetGrid);
  const blocksGeoJson = blocksToGeoJson(frame, response.blocks);
  const parcelsGeoJson = parcelsToGeoJson(frame, response.parcels);

  const tiff = terrainToGeoTiff(frame, {
    config: response.config,
    extent,
    heights,
    waterMask: new Uint8Array(response.waterMaskBuf),
    river: null,
    minHeight: response.minHeight,
    maxHeight: response.maxHeight,
    seaLevel: response.seaLevel,
  });

  const encoder = new TextEncoder();
  return zipSync({
    'extent.geojson': encoder.encode(stringify(extentGeoJson)),
    'water.geojson': encoder.encode(stringify(waterGeoJson)),
    'contours.geojson': encoder.encode(stringify(contoursGeoJson)),
    'ghost-grid.geojson': encoder.encode(stringify(gridGeoJson)),
    'downtown.geojson': encoder.encode(stringify(downtownGeoJson)),
    'townsite.geojson': encoder.encode(stringify(townsiteGeoJson)),
    'streets.geojson': encoder.encode(stringify(streetsGeoJson)),
    'blocks.geojson': encoder.encode(stringify(blocksGeoJson)),
    'parcels.geojson': encoder.encode(stringify(parcelsGeoJson)),
    'dem.tif': new Uint8Array(tiff),
    'README.txt': encoder.encode(buildReadme(response)),
  });
}

function buildReadme(response: GenerateResponse): string {
  return [
    'Hjemby export (stages 1–5)',
    '',
    `Seed: ${response.seed}`,
    `Anchor (WGS84): ${response.anchor.lat.toFixed(6)}, ${response.anchor.lon.toFixed(6)}`,
    `UTM zone: EPSG:${response.zoneEpsg}`,
    `Grid: ${response.config.cols} x ${response.config.rows} @ ${response.config.cellSize}m`,
    `River: ${response.river ? 'yes' : 'no'}`,
    `Elevation range: ${response.minHeight.toFixed(2)}m to ${response.maxHeight.toFixed(2)}m`,
    `Sea level (river surface datum): ${response.seaLevel}m`,
    '',
    `Downtown anchor: ${response.downtown.utm.e.toFixed(1)} E, ${response.downtown.utm.n.toFixed(1)} N (${response.downtown.reason})`,
    '',
    `Townsite: ${response.townsite.sideMeters.toFixed(1)} m square, bank=${response.townsite.bank ?? 'centered'}`,
    `Street grid: ${response.streetGrid.divisions}x${response.streetGrid.divisions} blocks (${response.streetGrid.streets.length} lines; streets=${response.streetGrid.streetsScheme}, avenues=${response.streetGrid.avenuesScheme})`,
    `Public square: block (col=${response.blocks.find((b) => b.kind === 'public-square')?.col}, row=${response.blocks.find((b) => b.kind === 'public-square')?.row})`,
    `Founder (initial owner of saleable parcels): ${response.founder.name}`,
    `Parcels: ${response.parcels.length} total (${countByUse(response.parcels, 'residential')} residential / ${countByUse(response.parcels, 'commercial')} commercial / ${countByUse(response.parcels, 'church')} church / ${countByUse(response.parcels, 'school')} school / ${countByUse(response.parcels, 'public-square')} public-square)`,
    '',
    'Files:',
    '  extent.geojson     - rectangular footprint of the terrain (EPSG:4326)',
    '  water.geojson      - water polygons in the carved river valley (EPSG:4326)',
    '  contours.geojson   - elevation contour lines, 5m intervals (EPSG:4326)',
    '  ghost-grid.geojson - PLS section grid (1-mile spacing; township boundaries tagged) (EPSG:4326)',
    '  downtown.geojson   - downtown anchor point (EPSG:4326)',
    '  townsite.geojson   - quarter-section townsite polygon (EPSG:4326)',
    '  streets.geojson    - founding-town street grid (EPSG:4326)',
    '  blocks.geojson     - blocks between streets; block_kind=public-square|school|commercial|residential (EPSG:4326)',
    '  parcels.geojson    - individual lots; use=residential|commercial|church|school|public-square (EPSG:4326)',
    `  dem.tif            - Float32 DEM in projected UTM (EPSG:${response.zoneEpsg})`,
    '',
  ].join('\n');
}

function countByUse(parcels: ReadonlyArray<{ use: string }>, use: string): number {
  let n = 0;
  for (const p of parcels) if (p.use === use) n++;
  return n;
}

export function triggerDownload(data: Uint8Array, filename: string, mime: string = 'application/zip'): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
