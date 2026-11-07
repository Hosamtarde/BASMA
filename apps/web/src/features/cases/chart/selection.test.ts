import { describe, expect, it } from 'vitest';
import { isQuadrantSelected, moveFocus, selectionReducer } from './selection';
import type { Selection } from './selection';

const run = (state: Selection, ...actions: Parameters<typeof selectionReducer>[1][]) =>
  actions.reduce(selectionReducer, state);

describe('selectionReducer', () => {
  it('toggles single teeth and keeps chart order without duplicates', () => {
    const s = run([], { type: 'toggle', tooth: 21 }, { type: 'toggle', tooth: 11 }, { type: 'toggle', tooth: 48 });
    expect(s).toEqual([11, 21, 48]);
    expect(run(s, { type: 'toggle', tooth: 21 })).toEqual([11, 48]);
  });

  it('removes a tooth (chip ×) and clears everything', () => {
    expect(run([11, 21], { type: 'remove', tooth: 11 })).toEqual([21]);
    expect(run([11, 21], { type: 'remove', tooth: 33 })).toEqual([11, 21]);
    expect(run([11, 21], { type: 'clear' })).toEqual([]);
  });

  it('selects all 32 teeth', () => {
    const s = run([], { type: 'all' });
    expect(s).toHaveLength(32);
    expect(s[0]).toBe(18);
    expect(s[31]).toBe(38);
  });

  it('adds a quadrant, and removes it when the quadrant is already fully selected', () => {
    const s = run([31], { type: 'quadrant', quadrant: 1 });
    expect(s).toEqual([18, 17, 16, 15, 14, 13, 12, 11, 31]);
    expect(isQuadrantSelected(s, 1)).toBe(true);
    expect(run(s, { type: 'quadrant', quadrant: 1 })).toEqual([31]);
    // Partially selected → completes it.
    expect(run([13], { type: 'quadrant', quadrant: 1 })).toHaveLength(8);
  });

  it('toggles a whole arch', () => {
    const s = run([], { type: 'arch', arch: 'lower' });
    expect(s).toHaveLength(16);
    expect(s.every((t) => t > 30)).toBe(true);
    expect(run(s, { type: 'arch', arch: 'lower' })).toEqual([]);
  });

  it('sets a list, dropping anything that is not a tooth', () => {
    expect(run([], { type: 'set', teeth: [22, 99, 12, 22] })).toEqual([12, 22]);
  });
});

describe('moveFocus', () => {
  it('moves along the row as the viewer sees it (18 on the left)', () => {
    expect(moveFocus(11, 'ArrowRight')).toBe(21);
    expect(moveFocus(21, 'ArrowLeft')).toBe(11);
    expect(moveFocus(18, 'ArrowLeft')).toBe(18);
    expect(moveFocus(28, 'ArrowRight')).toBe(28);
    expect(moveFocus(41, 'ArrowRight')).toBe(31);
  });

  it('jumps to the facing tooth of the other arch', () => {
    expect(moveFocus(13, 'ArrowDown')).toBe(43);
    expect(moveFocus(36, 'ArrowUp')).toBe(26);
    expect(moveFocus(13, 'ArrowUp')).toBe(13);
    expect(moveFocus(43, 'ArrowDown')).toBe(43);
  });

  it('goes to the ends of the row with Home and End, and ignores other keys', () => {
    expect(moveFocus(24, 'Home')).toBe(18);
    expect(moveFocus(24, 'End')).toBe(28);
    expect(moveFocus(45, 'End')).toBe(38);
    expect(moveFocus(24, 'Tab')).toBeNull();
    expect(moveFocus(99, 'ArrowLeft')).toBeNull();
  });
});
