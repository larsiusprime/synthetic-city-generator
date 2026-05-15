import type { GeoFrame } from '../geo';
import type { TerrainData } from '../terrain';

/**
 * Writes a single-band, float32 GeoTIFF of the terrain heightmap in the
 * frame's UTM projection. Single uncompressed strip, little-endian.
 *
 * TIFF rows are written top-down (row 0 = north edge). Our heightmap stores
 * row 0 at the south edge, so we flip rows on write.
 *
 * We implement the TIFF writer directly because `geotiff.js`'s `writeArrayBuffer`
 * silently truncates multi-byte samples (it treats every value as one byte
 * regardless of `BitsPerSample`).
 */
export function terrainToGeoTiff(frame: GeoFrame, terrain: TerrainData): ArrayBuffer {
  const { cols, rows } = terrain.config;
  const { extent } = terrain;

  // Tag types
  const SHORT = 3;
  const LONG = 4;
  const DOUBLE = 12;

  const headerSize = 8;
  const pixelByteCount = cols * rows * 4;
  const modelPixelScaleSize = 3 * 8;
  const modelTiepointSize = 6 * 8;
  const geoKeyDirShorts = 4 + 3 * 4;
  const geoKeyDirSize = geoKeyDirShorts * 2;

  let cursor = headerSize;
  const pixelDataOffset = cursor;
  cursor += pixelByteCount;
  const modelPixelScaleOffset = cursor;
  cursor += modelPixelScaleSize;
  const modelTiepointOffset = cursor;
  cursor += modelTiepointSize;
  const geoKeyDirOffset = cursor;
  cursor += geoKeyDirSize;
  const ifdOffset = cursor;

  const numEntries = 13;
  const ifdSize = 2 + numEntries * 12 + 4;
  const totalSize = ifdOffset + ifdSize;

  const buf = new ArrayBuffer(totalSize);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // TIFF header (little-endian)
  dv.setUint16(0, 0x4949, true);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOffset, true);

  // Pixel strip: write rows flipped (TIFF row 0 = north edge)
  const f32 = new Float32Array(buf, pixelDataOffset, cols * rows);
  for (let r = 0; r < rows; r++) {
    const srcRow = rows - 1 - r;
    f32.set(terrain.heights.subarray(srcRow * cols, srcRow * cols + cols), r * cols);
  }

  // ModelPixelScale: 3 doubles [dx, dy, dz]
  dv.setFloat64(modelPixelScaleOffset + 0, extent.cellSize, true);
  dv.setFloat64(modelPixelScaleOffset + 8, extent.cellSize, true);
  dv.setFloat64(modelPixelScaleOffset + 16, 0, true);

  // ModelTiepoint: 6 doubles [I, J, K, X, Y, Z] — raster (0,0,0) -> world (minE, maxN, 0)
  dv.setFloat64(modelTiepointOffset + 0, 0, true);
  dv.setFloat64(modelTiepointOffset + 8, 0, true);
  dv.setFloat64(modelTiepointOffset + 16, 0, true);
  dv.setFloat64(modelTiepointOffset + 24, extent.minE, true);
  dv.setFloat64(modelTiepointOffset + 32, extent.maxN, true);
  dv.setFloat64(modelTiepointOffset + 40, 0, true);

  // GeoKeyDirectory: 4 header shorts + 3 keys × 4 shorts
  let gk = geoKeyDirOffset;
  dv.setUint16(gk + 0, 1, true); // KeyDirectoryVersion
  dv.setUint16(gk + 2, 1, true); // KeyRevision
  dv.setUint16(gk + 4, 0, true); // MinorRevision
  dv.setUint16(gk + 6, 3, true); // NumberOfKeys
  gk += 8;
  // GTModelTypeGeoKey (1024) = 1 (Projected)
  dv.setUint16(gk + 0, 1024, true);
  dv.setUint16(gk + 2, 0, true);
  dv.setUint16(gk + 4, 1, true);
  dv.setUint16(gk + 6, 1, true);
  gk += 8;
  // GTRasterTypeGeoKey (1025) = 1 (RasterPixelIsArea)
  dv.setUint16(gk + 0, 1025, true);
  dv.setUint16(gk + 2, 0, true);
  dv.setUint16(gk + 4, 1, true);
  dv.setUint16(gk + 6, 1, true);
  gk += 8;
  // ProjectedCSTypeGeoKey (3072) = EPSG of the UTM zone
  dv.setUint16(gk + 0, 3072, true);
  dv.setUint16(gk + 2, 0, true);
  dv.setUint16(gk + 4, 1, true);
  dv.setUint16(gk + 6, frame.zone.epsg, true);

  // IFD: 13 entries, sorted by tag id
  let p = ifdOffset;
  dv.setUint16(p, numEntries, true);
  p += 2;

  const writeEntry = (tag: number, type: number, count: number, valueOrOffset: number, asShort: boolean = false) => {
    dv.setUint16(p, tag, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, count, true);
    if (asShort) {
      dv.setUint16(p + 8, valueOrOffset, true);
      dv.setUint16(p + 10, 0, true);
    } else {
      dv.setUint32(p + 8, valueOrOffset, true);
    }
    p += 12;
  };

  writeEntry(256, LONG, 1, cols);
  writeEntry(257, LONG, 1, rows);
  writeEntry(258, SHORT, 1, 32, true);
  writeEntry(259, SHORT, 1, 1, true);
  writeEntry(262, SHORT, 1, 1, true);
  writeEntry(273, LONG, 1, pixelDataOffset);
  writeEntry(277, SHORT, 1, 1, true);
  writeEntry(278, LONG, 1, rows);
  writeEntry(279, LONG, 1, pixelByteCount);
  writeEntry(339, SHORT, 1, 3, true);
  writeEntry(33550, DOUBLE, 3, modelPixelScaleOffset);
  writeEntry(33922, DOUBLE, 6, modelTiepointOffset);
  writeEntry(34735, SHORT, geoKeyDirShorts, geoKeyDirOffset);

  dv.setUint32(p, 0, true);

  return u8.buffer.slice(0);
}
