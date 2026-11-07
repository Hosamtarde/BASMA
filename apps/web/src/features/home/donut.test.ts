import { describe, expect, it } from 'vitest';
import { donutArcs } from './donut';

describe('donutArcs', () => {
  it('splits the ring in proportion, in order, skipping zero counts', () => {
    const arcs = donutArcs(
      [
        { key: 'a', count: 1 },
        { key: 'b', count: 0 },
        { key: 'c', count: 3 },
      ],
      100,
    );
    expect(arcs).toEqual([
      { key: 'a', count: 1, start: 0, length: 25 },
      { key: 'c', count: 3, start: 25, length: 75 },
    ]);
  });

  it('always covers the whole ring, with no gap from rounding', () => {
    const c = 2 * Math.PI * 52.5;
    const arcs = donutArcs(
      [
        { key: 'a', count: 1 },
        { key: 'b', count: 1 },
        { key: 'c', count: 1 },
      ],
      c,
    );
    const last = arcs.at(-1);
    expect(last && last.start + last.length).toBeCloseTo(c, 10);
    expect(arcs.reduce((s, a) => s + a.length, 0)).toBeCloseTo(c, 10);
  });

  it('a single status fills the ring; no cases give no arcs', () => {
    expect(donutArcs([{ key: 'a', count: 7 }], 10)).toEqual([{ key: 'a', count: 7, start: 0, length: 10 }]);
    expect(donutArcs([{ key: 'a', count: 0 }], 10)).toEqual([]);
  });
});
