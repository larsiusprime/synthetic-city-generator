/**
 * Alphabetical fruit/vegetable name list used for street naming. Indexed
 * deterministically; sufficient for any reasonable street count we'd produce
 * in early stages. If we exceed 20 streets per axis later, extend the list.
 */
export const PRODUCE_NAMES: readonly string[] = [
  'Apple',
  'Banana',
  'Cherry',
  'Daikon',
  'Eggplant',
  'Fennel',
  'Grape',
  'Honey',
  'Iceberg',
  'Jicama',
  'Kale',
  'Lemon',
  'Mango',
  'Nectarine',
  'Onion',
  'Pear',
  'Quince',
  'Radish',
  'Spinach',
  'Tomato',
];

const ORDINAL_SUFFIX: Record<string, string> = {
  '1': 'st',
  '2': 'nd',
  '3': 'rd',
};

export function ordinal(n: number): string {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  const last = String(n % 10);
  const suffix = ORDINAL_SUFFIX[last] ?? 'th';
  return `${n}${suffix}`;
}
