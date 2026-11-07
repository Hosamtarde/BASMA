import { ALL_TEETH } from '@app/shared';
import { describe, expect, it } from 'vitest';
import { badgeCenter, badgeRadius, chartLayout } from './geometry';
import type { ChartView } from './geometry';

const views: ChartView[] = ['mouth', 'rows'];

describe.each(views)('chart layout (%s)', (view) => {
  const layout = chartLayout(view);
  const byNo = new Map(layout.teeth.map((t) => [t.no, t]));

  it('has the 32 teeth once each, with crown, details and a hit area', () => {
    expect(layout.teeth.map((t) => t.no).sort()).toEqual([...ALL_TEETH].sort());
    for (const t of layout.teeth) {
      expect(t.crown).toMatch(/^M/);
      expect(t.hit).toContain(t.crown);
      expect(t.details.length).toBeGreaterThan(0);
      expect(t.roots === null).toBe(view === 'mouth');
    }
  });

  it('keeps 18 on the viewer left and 28 on the right; quadrants 1 and 4 left of the midline', () => {
    const x = (no: number) => byNo.get(no)?.center.x ?? Number.NaN;
    expect(x(18)).toBeLessThan(x(28));
    expect(x(48)).toBeLessThan(x(38));
    for (const no of ALL_TEETH) {
      const q = Math.floor(no / 10);
      if (q === 1 || q === 4) expect(x(no)).toBeLessThan(0);
      else expect(x(no)).toBeGreaterThan(0);
    }
  });

  it('puts the upper arch above the lower arch', () => {
    const maxUpper = Math.max(...layout.teeth.filter((t) => t.arch === 'upper').map((t) => t.center.y));
    const minLower = Math.min(...layout.teeth.filter((t) => t.arch === 'lower').map((t) => t.center.y));
    expect(maxUpper).toBeLessThan(minLower);
  });

  it('keeps every badge, at its largest size, inside the view box and apart from its neighbours', () => {
    const r = layout.maxBadgeR;
    const { x, y, w, h } = layout.viewBox;
    expect(r).toBeGreaterThanOrEqual(layout.baseBadgeR);
    for (const t of layout.teeth) {
      const c = badgeCenter(t, r);
      expect(c.x - r).toBeGreaterThanOrEqual(x);
      expect(c.x + r).toBeLessThanOrEqual(x + w);
      expect(c.y - r).toBeGreaterThanOrEqual(y);
      expect(c.y + r).toBeLessThanOrEqual(y + h);
    }
    const centres = layout.teeth.map((t) => badgeCenter(t, r));
    for (let i = 0; i < centres.length; i++) {
      for (let j = i + 1; j < centres.length; j++) {
        const a = centres[i]!;
        const b = centres[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * r);
      }
    }
  });

  it('is deterministic (same object for the same view)', () => {
    expect(chartLayout(view)).toBe(layout);
  });
});

describe('badgeRadius', () => {
  const layout = chartLayout('mouth');

  it('grows the badge to the target size on a small chart, within the neighbour cap', () => {
    // 3 px per unit: 16 px wide → radius 8/3 units.
    expect(badgeRadius(layout, 3, 16)).toBeCloseTo(8 / 3, 5);
    expect(badgeRadius(layout, 1, 16)).toBe(layout.maxBadgeR);
  });

  it('never goes below the natural size on a large chart', () => {
    expect(badgeRadius(layout, 20, 16)).toBe(layout.baseBadgeR);
    expect(badgeRadius(layout, 0, 16)).toBe(layout.baseBadgeR);
  });
});
