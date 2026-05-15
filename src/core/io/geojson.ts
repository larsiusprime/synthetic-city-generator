import { utmToLonLat, type GeoFrame, type GridExtent, type UtmCoord } from '../geo';
import type { ContourLevel } from '../terrain/vectorize';
import type { DowntownAnchor, GhostGrid } from '../survey';

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
