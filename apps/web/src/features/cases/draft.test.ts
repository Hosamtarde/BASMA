import { describe, expect, it } from 'vitest';
import {
  lineForArea,
  linesForTeeth,
  previewPrice,
  previewSubtotal,
  teethWork,
  toLineInputs,
  workColors,
  WORK_COLORS,
} from './draft';

const zircon = { id: 3, name: 'زيركون', unitPrice: 25000 };
const emax = { id: 5, name: 'إي-ماكس', unitPrice: 30000 };

describe('draft lines', () => {
  it('makes one line per selected tooth with the same work type and shade', () => {
    const lines = linesForTeeth([13, 23], zircon, 'A2');
    expect(lines.map((l) => [l.toothNo, l.area, l.workTypeId, l.shade, l.manualPrice])).toEqual([
      [13, null, 3, 'A2', ''],
      [23, null, 3, 'A2', ''],
    ]);
    expect(new Set(lines.map((l) => l.key)).size).toBe(2);
  });

  it('makes a whole-arch line with an area and no tooth', () => {
    const line = lineForArea('both_arches', emax, null);
    expect([line.toothNo, line.area, line.shade]).toEqual([null, 'both_arches', null]);
  });

  it('previews the special price, else the general one, else the manual one (labelled)', () => {
    const [line] = linesForTeeth([11], zircon, null);
    expect(previewPrice(line!, new Map(), 2)).toEqual({ ok: true, minor: 25000, source: 'general' });
    expect(previewPrice(line!, new Map([[3, null]]), 2)).toEqual({ ok: true, minor: 25000, source: 'general' });
    expect(previewPrice(line!, new Map([[3, 22000]]), 2)).toEqual({ ok: true, minor: 22000, source: 'special' });
    expect(previewPrice({ ...line!, manualPrice: '199.5' }, new Map([[3, 22000]]), 2)).toEqual({
      ok: true,
      minor: 19950,
      source: 'manual',
    });
    expect(previewPrice({ ...line!, manualPrice: '1.555' }, new Map(), 2)).toEqual({
      ok: false,
      error: 'tooManyDecimals',
    });
  });

  it('adds the preview subtotal in integer minor units, or none while a price is invalid', () => {
    const lines = [...linesForTeeth([11, 21], zircon, null), lineForArea('upper_arch', emax, null)];
    expect(previewSubtotal(lines, new Map([[5, 28000]]), 2)).toBe(25000 + 25000 + 28000);
    expect(previewSubtotal([{ ...lines[0]!, manualPrice: 'abc' }], new Map(), 2)).toBeNull();
    expect(previewSubtotal([], new Map(), 2)).toBe(0);
  });

  it('sends a price only when typed, so the server resolves special and general prices itself', () => {
    const lines = [
      ...linesForTeeth([11], zircon, 'A1'),
      { ...lineForArea('lower_arch', emax, null), manualPrice: '120' },
    ];
    expect(toLineInputs(lines, 2)).toEqual({
      ok: true,
      lines: [
        { workTypeId: 3, shade: 'A1', toothNo: 11 },
        { workTypeId: 5, shade: null, area: 'lower_arch', unitPrice: 12000 },
      ],
    });
    const bad = { ...lines[0]!, manualPrice: '-5' };
    const result = toLineInputs([bad], 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.get(bad.key)).toBe('negative');
  });

  it('colours work types in order of first use and marks the teeth that have work', () => {
    const lines = [...linesForTeeth([11, 21], zircon, null), ...linesForTeeth([21, 36], emax, null)];
    const colors = workColors(lines);
    expect([...colors]).toEqual([
      [3, WORK_COLORS[0]],
      [5, WORK_COLORS[1]],
    ]);
    const work = teethWork(lines, colors);
    expect(work.get(11)).toEqual({ color: WORK_COLORS[0], names: ['زيركون'] });
    expect(work.get(21)).toEqual({ color: WORK_COLORS[0], names: ['زيركون', 'إي-ماكس'] });
    expect(work.get(36)?.color).toBe(WORK_COLORS[1]);
    expect(work.has(12)).toBe(false);
  });
});
