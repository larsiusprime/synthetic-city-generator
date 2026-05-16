import { utmToLonLat, type GeoFrame, type GridExtent, type UtmCoord } from '../geo';
import type { ContourLevel } from '../terrain/vectorize';
import type { Block, DowntownAnchor, GhostGrid, Parcel, Street, StreetGrid, Townsite } from '../survey';

type Position = readonly [number, number];

interface PointGeometry {
  type: 'Point';
  coordinates: Position;
}

interface LineStringGeometry {
  type: 'LineString';
  coordinates: Position[];
}

interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Position[][];
}

type Geometry = PointGeometry | LineStringGeometry | PolygonGeometry;

export interface Feature<P extends Record<string, unknown> = Record<string, unknown>> {
  type: 'Feature';
  geometry: Geometry;
  properties: P;
}

export interface FeatureCollection<P extends Record<string, unknown> = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: Feature<P>[];
}

function utmRingToLonLat(frame: GeoFrame, ring: readonly UtmCoord[]): Position[] {
  const out: Position[] = new Array(ring.length);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const ll = utmToLonLat(frame, p.e, p.n);
    out[i] = [round6(ll.lon), round6(ll.lat)];
  }
  return out;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function extentToGeoJson(frame: GeoFrame, extent: GridExtent): FeatureCollection {
  const ring: UtmCoord[] = [
    { e: extent.minE, n: extent.minN },
    { e: extent.maxE, n: extent.minN },
    { e: extent.maxE, n: extent.maxN },
    { e: extent.minE, n: extent.maxN },
    { e: extent.minE, n: extent.minN },
  ];
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [utmRingToLonLat(frame, ring)] },
        properties: { kind: 'extent' },
      },
    ],
  };
}

export function waterPolygonsToGeoJson(frame: GeoFrame, polygons: readonly (readonly UtmCoord[])[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: polygons.map((ring) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [utmRingToLonLat(frame, ring)] },
      properties: { kind: 'water' },
    })),
  };
}

export function contoursToGeoJson(frame: GeoFrame, levels: readonly ContourLevel[]): FeatureCollection {
  const features: Feature[] = [];
  for (const level of levels) {
    for (const line of level.lines) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: utmRingToLonLat(frame, line) },
        properties: { kind: 'contour', elevation: level.elevation },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

export function ghostGridToGeoJson(frame: GeoFrame, grid: GhostGrid): FeatureCollection {
  const features: Feature[] = grid.lines.map((line) => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: utmRingToLonLat(frame, [line.a, line.b]),
    },
    properties: {
      kind: 'ghost-grid',
      tier: line.tier,
      direction: line.direction,
      index: line.index,
    },
  }));
  return { type: 'FeatureCollection', features };
}

export function townsiteToGeoJson(frame: GeoFrame, townsite: Townsite): FeatureCollection {
  const ring: UtmCoord[] = [...townsite.ring, townsite.ring[0]!];
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [utmRingToLonLat(frame, ring)] },
        properties: { kind: 'townsite', side_meters: townsite.sideMeters, bank: townsite.bank },
      },
    ],
  };
}

export function streetsToGeoJson(frame: GeoFrame, streets: readonly Street[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: streets.map((s) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: utmRingToLonLat(frame, s.points) },
      properties: { kind: 'street', name: s.name, axis: s.axis, index: s.index },
    })),
  };
}

export function streetGridToGeoJson(frame: GeoFrame, grid: StreetGrid): FeatureCollection {
  return streetsToGeoJson(frame, grid.streets);
}

export function parcelsToGeoJson(frame: GeoFrame, parcels: readonly Parcel[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: parcels.map((p) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [utmRingToLonLat(frame, [...p.ring, p.ring[0]!])],
      },
      properties: {
        kind: 'parcel',
        id: p.id,
        block_col: p.blockCol,
        block_row: p.blockRow,
        lot_number: p.lotNumber,
        use: p.use,
        area_sqm: Math.round(p.areaSqM * 100) / 100,
        frontage_street: p.frontageStreet,
        owner_id: p.ownerId,
      },
    })),
  };
}

export function blocksToGeoJson(frame: GeoFrame, blocks: readonly Block[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: blocks.map((b) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [utmRingToLonLat(frame, [...b.ring, b.ring[0]!])],
      },
      properties: {
        kind: 'block',
        block_kind: b.kind,
        col: b.col,
        row: b.row,
        public_square: b.kind === 'public-square',
      },
    })),
  };
}

export function downtownToGeoJson(frame: GeoFrame, downtown: DowntownAnchor): FeatureCollection {
  const ll = utmToLonLat(frame, downtown.utm.e, downtown.utm.n);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [round6(ll.lon), round6(ll.lat)] },
        properties: { kind: 'downtown-anchor', reason: downtown.reason },
      },
    ],
  };
}

export function stringify(fc: FeatureCollection): string {
  return JSON.stringify(fc);
}
