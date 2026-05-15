import type { UtmCoord } from '../geo';
import type { DowntownAnchor } from './downtown';
import { PRODUCE_NAMES, ordinal } from './names';
import type { Townsite, TownsiteBank } from './townsite';

export type StreetAxis = 'meridian' | 'parallel';
export type StreetNameScheme = 'numbered' | 'produce';

export interface Street {
  name: string;
  axis: StreetAxis;
  /** Position index 0..divisions along this axis (0 = south/west). */
  index: number;
  a: UtmCoord;
  b: UtmCoord;
}

export interface StreetGrid {
  /** Number of blocks per axis. (5 streets per axis = `divisions + 1` lines.) */
  divisions: number;
  /** Scheme used for the streets (E-W) axis. */
  streetsScheme: StreetNameScheme;
  /** Scheme used for the avenues (N-S) axis. */
  avenuesScheme: StreetNameScheme;
  streets: Street[];
}

const DIVISIONS = 4;

interface Trunk {
  streetsIdx: number;
  avenuesIdx: number;
  streetsName: string;
  avenuesName: string;
}

function trunkFor(bank: TownsiteBank | null): Trunk {
  const center = DIVISIONS / 2;
  if (bank === null) {
    return {
      streetsIdx: center,
      avenuesIdx: center,
      streetsName: 'Main Street',
      avenuesName: 'First Avenue',
    };
  }
  switch (bank) {
    case 'north':
      return { streetsIdx: 0, avenuesIdx: center, streetsName: 'Front Street', avenuesName: 'Main Avenue' };
    case 'south':
      return { streetsIdx: DIVISIONS, avenuesIdx: center, streetsName: 'Front Street', avenuesName: 'Main Avenue' };
    case 'east':
      return { streetsIdx: center, avenuesIdx: 0, streetsName: 'Main Street', avenuesName: 'Front Avenue' };
    case 'west':
      return { streetsIdx: center, avenuesIdx: DIVISIONS, streetsName: 'Main Street', avenuesName: 'Front Avenue' };
  }
}

function nameAt(index: number, axis: 'street' | 'avenue', scheme: StreetNameScheme): string {
  const suffix = axis === 'street' ? 'Street' : 'Avenue';
  if (scheme === 'numbered') return `${ordinal(index + 1)} ${suffix}`;
  const produce = PRODUCE_NAMES[index];
  if (produce === undefined) throw new Error(`PRODUCE_NAMES exhausted at index ${index}`);
  return `${produce} ${suffix}`;
}

/**
 * Builds the full street grid for a founding town: a `(divisions+1) × (divisions+1)`
 * cardinal grid that fills the townsite. The trunk lines retain iconic names
 * (Main / Front / First); all other lines are named from the seeded scheme.
 *
 * `streetsNumberedCoin` is a deterministic boolean (typically from a PRNG
 * substream) that decides whether the streets axis (E-W) gets numbered names
 * with the avenues axis (N-S) getting produce names, or vice versa.
 */
export function buildStreets(
  townsite: Townsite,
  _downtown: DowntownAnchor,
  streetsNumberedCoin: boolean,
): StreetGrid {
  const minE = townsite.sw.e;
  const minN = townsite.sw.n;
  const side = townsite.sideMeters;
  const step = side / DIVISIONS;
  const trunk = trunkFor(townsite.bank);

  const streetsScheme: StreetNameScheme = streetsNumberedCoin ? 'numbered' : 'produce';
  const avenuesScheme: StreetNameScheme = streetsNumberedCoin ? 'produce' : 'numbered';

  const streets: Street[] = [];

  for (let i = 0; i <= DIVISIONS; i++) {
    const n = minN + i * step;
    const name = i === trunk.streetsIdx ? trunk.streetsName : nameAt(i, 'street', streetsScheme);
    streets.push({
      name,
      axis: 'parallel',
      index: i,
      a: { e: minE, n },
      b: { e: minE + side, n },
    });
  }

  for (let i = 0; i <= DIVISIONS; i++) {
    const e = minE + i * step;
    const name = i === trunk.avenuesIdx ? trunk.avenuesName : nameAt(i, 'avenue', avenuesScheme);
    streets.push({
      name,
      axis: 'meridian',
      index: i,
      a: { e, n: minN },
      b: { e, n: minN + side },
    });
  }

  return { divisions: DIVISIONS, streetsScheme, avenuesScheme, streets };
}

export { DIVISIONS as STREET_GRID_DIVISIONS };
