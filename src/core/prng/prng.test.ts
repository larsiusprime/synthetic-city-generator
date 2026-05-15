import { describe, expect, it } from 'vitest';
import { Prng } from './index';

describe('Prng', () => {
  it('produces deterministic sequences from a seed', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const seqA = Array.from({ length: 10 }, () => a.float());
    const seqB = Array.from({ length: 10 }, () => b.float());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Prng(1);
    const b = new Prng(2);
    const va = a.float();
    const vb = b.float();
    expect(va).not.toBe(vb);
  });

  it('floats fall in [0, 1)', () => {
    const p = new Prng(7);
    for (let i = 0; i < 1000; i++) {
      const v = p.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(min,max) is inclusive on both ends', () => {
    const p = new Prng(7);
    const counts = new Map<number, number>();
    for (let i = 0; i < 5000; i++) {
      const v = p.int(0, 4);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    for (let i = 0; i <= 4; i++) {
      expect(counts.get(i)).toBeGreaterThan(0);
    }
    expect([...counts.keys()].every((k) => k >= 0 && k <= 4)).toBe(true);
  });

  it('named substreams are deterministic and reused', () => {
    const a = new Prng(123);
    const b = new Prng(123);
    const subA1 = a.substream('terrain.macro');
    const subA2 = a.substream('terrain.macro');
    const subB = b.substream('terrain.macro');
    expect(subA1).toBe(subA2);
    expect(subA1.float()).toBe(subB.float());
  });

  it('different substream names produce different streams', () => {
    const p = new Prng(0xfeed);
    const a = p.substream('terrain.macro');
    const b = p.substream('terrain.texture');
    expect(a.float()).not.toBe(b.float());
  });
});
