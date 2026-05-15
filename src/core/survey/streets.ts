import type { UtmCoord } from '../geo';
import type { DowntownAnchor } from './downtown';
import type { Townsite } from './townsite';

export type StreetAxis = 'meridian' | 'parallel';

export interface Street {
  name: string;
  axis: StreetAxis;
  a: UtmCoord;
  b: UtmCoord;
}

/**
 * The two trunk streets of the founding town.
 *
 * For a river city, Front Street runs along the riverfront edge of the
 * townsite (anchor at its midpoint) and Main Street extends from the anchor
 * perpendicular to the river, all the way to the far edge of the townsite.
 * Together they form a T at the anchor.
 *
 * For a riverless city, Main Street (E-W) and First Avenue (N-S) cross at the
 * townsite center, each spanning the full townsite.
 */
export function buildTrunkStreets(townsite: Townsite, downtown: DowntownAnchor): Street[] {
  const half = townsite.sideMeters / 2;
  const a = downtown.utm;

  if (townsite.bank === null) {
    const c = townsite.center;
    return [
      {
        name: 'Main Street',
        axis: 'parallel',
        a: { e: c.e - half, n: c.n },
        b: { e: c.e + half, n: c.n },
      },
      {
        name: 'First Avenue',
        axis: 'meridian',
        a: { e: c.e, n: c.n - half },
        b: { e: c.e, n: c.n + half },
      },
    ];
  }

  if (townsite.bank === 'north' || townsite.bank === 'south') {
    const inlandSign = townsite.bank === 'north' ? 1 : -1;
    return [
      {
        name: 'Front Street',
        axis: 'parallel',
        a: { e: a.e - half, n: a.n },
        b: { e: a.e + half, n: a.n },
      },
      {
        name: 'Main Street',
        axis: 'meridian',
        a: { e: a.e, n: a.n },
        b: { e: a.e, n: a.n + inlandSign * townsite.sideMeters },
      },
    ];
  }

  const inlandSign = townsite.bank === 'east' ? 1 : -1;
  return [
    {
      name: 'Front Street',
      axis: 'meridian',
      a: { e: a.e, n: a.n - half },
      b: { e: a.e, n: a.n + half },
    },
    {
      name: 'Main Street',
      axis: 'parallel',
      a: { e: a.e, n: a.n },
      b: { e: a.e + inlandSign * townsite.sideMeters, n: a.n },
    },
  ];
}
