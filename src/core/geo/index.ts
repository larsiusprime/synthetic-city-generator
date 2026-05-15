import proj4 from 'proj4';

export interface LonLat {
  lon: number;
  lat: number;
}

export interface UtmCoord {
  e: number;
  n: number;
}

export interface UtmZone {
  number: number;
  north: boolean;
  epsg: number;
  projString: string;
}

/**
 * A GeoFrame anchors a synthetic terrain grid to a real-world UTM zone.
 * All sim math is in UTM meters relative to (anchorE, anchorN).
 */
export interface GeoFrame {
  zone: UtmZone;
  anchorLonLat: LonLat;
  anchorE: number;
  anchorN: number;
}

const WGS84 = 'EPSG:4326';

export function utmZoneFor(ll: LonLat): UtmZone {
  const number = Math.floor((ll.lon + 180) / 6) + 1;
  const north = ll.lat >= 0;
  const epsg = (north ? 32600 : 32700) + number;
  const projString = `+proj=utm +zone=${number}${north ? '' : ' +south'} +datum=WGS84 +units=m +no_defs`;
  return { number, north, epsg, projString };
}

const registeredZones = new Set<number>();

function registerZone(zone: UtmZone): string {
  const name = `EPSG:${zone.epsg}`;
  if (!registeredZones.has(zone.epsg)) {
    proj4.defs(name, zone.projString);
    registeredZones.add(zone.epsg);
  }
  return name;
}

export function makeFrame(anchor: LonLat): GeoFrame {
  const zone = utmZoneFor(anchor);
  const epsgName = registerZone(zone);
  const [anchorE, anchorN] = proj4(WGS84, epsgName, [anchor.lon, anchor.lat]);
  return { zone, anchorLonLat: anchor, anchorE, anchorN };
}

export function utmToLonLat(frame: GeoFrame, e: number, n: number): LonLat {
  const epsgName = registerZone(frame.zone);
  const [lon, lat] = proj4(epsgName, WGS84, [e, n]);
  return { lon, lat };
}

export function lonLatToUtm(frame: GeoFrame, ll: LonLat): UtmCoord {
  const epsgName = registerZone(frame.zone);
  const [e, n] = proj4(WGS84, epsgName, [ll.lon, ll.lat]);
  return { e, n };
}

/**
 * Bounding rectangle of a centered grid in local UTM meters.
 * cells (cols x rows), cellSize in meters. The grid is centered on the frame anchor.
 */
export interface GridExtent {
  cols: number;
  rows: number;
  cellSize: number;
  minE: number;
  minN: number;
  maxE: number;
  maxN: number;
}

export function centeredGridExtent(frame: GeoFrame, cols: number, rows: number, cellSize: number): GridExtent {
  const halfW = (cols * cellSize) / 2;
  const halfH = (rows * cellSize) / 2;
  return {
    cols,
    rows,
    cellSize,
    minE: frame.anchorE - halfW,
    minN: frame.anchorN - halfH,
    maxE: frame.anchorE + halfW,
    maxN: frame.anchorN + halfH,
  };
}

/** UTM coordinates of cell (col, row) center within a grid. */
export function cellCenterUtm(extent: GridExtent, col: number, row: number): UtmCoord {
  return {
    e: extent.minE + (col + 0.5) * extent.cellSize,
    n: extent.minN + (row + 0.5) * extent.cellSize,
  };
}

export type LonLatRing = LonLat[];

/** Four corners of the grid extent in WGS84 lon/lat, CCW starting at SW. */
export function gridExtentCornersLonLat(frame: GeoFrame, extent: GridExtent): LonLatRing {
  return [
    utmToLonLat(frame, extent.minE, extent.minN),
    utmToLonLat(frame, extent.maxE, extent.minN),
    utmToLonLat(frame, extent.maxE, extent.maxN),
    utmToLonLat(frame, extent.minE, extent.maxN),
  ];
}
