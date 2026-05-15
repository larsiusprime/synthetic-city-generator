import { describe, expect, it } from 'vitest';
import { centeredGridExtent, makeFrame } from '../geo';
import {
  contoursToGeoJson,
  extentToGeoJson,
  stringify,
  waterPolygonsToGeoJson,
} from './geojson';

const KANSAS_CITY = { lat: 39.0997, lon: -94.5786 };

describe('geojson exporters', () => {
  const frame = makeFrame(KANSAS_CITY);
  const extent = centeredGridExtent(frame, 64, 64, 10);

  it('extentToGeoJson produces a closed polygon ring', () => {
    const fc = extentToGeoJson(frame, extent);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0]!;
    expect(f.geometry.type).toBe('Polygon');
    if (f.geometry.type !== 'Polygon') throw new Error('unreachable');
    const ring = f.geometry.coordinates[0]!;
    expect(ring.length).toBe(5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('extent corners are near the anchor lat/lon', () => {
    const fc = extentToGeoJson(frame, extent);
    const f = fc.features[0]!;
    if (f.geometry.type !== 'Polygon') throw new Error('unreachable');
    const ring = f.geometry.coordinates[0]!;
    for (const [lon, lat] of ring) {
      expect(Math.abs(lat - KANSAS_CITY.lat)).toBeLessThan(0.1);
      expect(Math.abs(lon - KANSAS_CITY.lon)).toBeLessThan(0.1);
    }
  });

  it('contoursToGeoJson tags features with elevation', () => {
    const levels = [
      { elevation: 10, lines: [[{ e: extent.minE, n: extent.minN }, { e: extent.maxE, n: extent.maxN }]] },
      { elevation: 20, lines: [] },
    ];
    const fc = contoursToGeoJson(frame, levels);
    expect(fc.features.length).toBe(1);
    expect(fc.features[0]!.properties).toMatchObject({ kind: 'contour', elevation: 10 });
  });

  it('waterPolygonsToGeoJson produces one feature per ring', () => {
    const ring = [
      { e: extent.minE, n: extent.minN },
      { e: extent.maxE, n: extent.minN },
      { e: extent.maxE, n: extent.maxN },
      { e: extent.minE, n: extent.minN },
    ];
    const fc = waterPolygonsToGeoJson(frame, [ring]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry.type).toBe('Polygon');
  });

  it('stringify produces valid JSON', () => {
    const fc = extentToGeoJson(frame, extent);
    const text = stringify(fc);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});
