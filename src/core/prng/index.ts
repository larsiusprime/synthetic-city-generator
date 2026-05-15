function sfc32(a: number, b: number, c: number, d: number): () => number {
  let s0 = a | 0;
  let s1 = b | 0;
  let s2 = c | 0;
  let s3 = d | 0;
  return function next(): number {
    s0 |= 0;
    s1 |= 0;
    s2 |= 0;
    s3 |= 0;
    const t = (((s0 + s1) | 0) + s3) | 0;
    s3 = (s3 + 1) | 0;
    s0 = s1 ^ (s1 >>> 9);
    s1 = (s2 + (s2 << 3)) | 0;
    s2 = (s2 << 21) | (s2 >>> 11);
    s2 = (s2 + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function fnv1a32(str: string, seed: number = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Prng {
  private readonly next: () => number;
  private readonly substreams = new Map<string, Prng>();
  private readonly rootSeed: number;
  private readonly nameSeed: number;
  private gaussianCache: number | undefined;

  constructor(rootSeed: number, nameSeed: number = 0) {
    this.rootSeed = rootSeed >>> 0;
    this.nameSeed = nameSeed >>> 0;
    const a = (this.rootSeed ^ 0x9e3779b9) >>> 0;
    const b = (this.nameSeed ^ 0x6a09e667) >>> 0;
    const c = (Math.imul(this.rootSeed, 0xdeadbeef) ^ this.nameSeed) >>> 0;
    const d = ((this.rootSeed >>> 16) ^ this.nameSeed ^ 0x85ebca6b) >>> 0;
    this.next = sfc32(a, b, c, d);
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Deterministic named child stream. Same name always returns the same instance. */
  substream(name: string): Prng {
    const cached = this.substreams.get(name);
    if (cached !== undefined) return cached;
    const childSeed = fnv1a32(name, this.nameSeed === 0 ? 0x811c9dc5 : this.nameSeed);
    const child = new Prng(this.rootSeed, childSeed);
    this.substreams.set(name, child);
    return child;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(min + (max - min + 1) * this.next());
  }

  /** Bernoulli trial with probability p. */
  bool(p: number = 0.5): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box-Muller, caching the paired value. */
  gaussian(): number {
    if (this.gaussianCache !== undefined) {
      const v = this.gaussianCache;
      this.gaussianCache = undefined;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    const z1 = mag * Math.sin(2 * Math.PI * v);
    this.gaussianCache = z1;
    return mag * Math.cos(2 * Math.PI * v);
  }

  /** Picks one element uniformly from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Prng.pick: empty array');
    const idx = Math.floor(this.next() * arr.length);
    return arr[idx]!;
  }
}
