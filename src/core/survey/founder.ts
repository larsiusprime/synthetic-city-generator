import type { Prng } from '../prng';

const SURNAMES: readonly string[] = [
  'Ashcroft',
  'Bingham',
  'Carlisle',
  'Drummond',
  'Ellsworth',
  'Fairchild',
  'Granville',
  'Hawthorne',
  'Ingram',
  'Jameson',
  'Kingsbury',
  'Lockwood',
  'Montgomery',
  'Norton',
  'Pemberton',
  'Quincy',
  'Radcliffe',
  'Sutherland',
  'Thornton',
  'Underhill',
  'Vance',
  'Wakefield',
  'Whitman',
  'Yardley',
];

const SUFFIXES: readonly string[] = ['Town Co.', 'Land Co.', '& Sons', 'Brothers'];

export interface Founder {
  id: string;
  name: string;
}

/** Picks a deterministic founder name from a seeded substream. */
export function pickFounder(prng: Prng): Founder {
  const surname = prng.pick(SURNAMES);
  const suffix = prng.pick(SUFFIXES);
  const name = `${surname} ${suffix}`;
  return { id: 'founder-1', name };
}
