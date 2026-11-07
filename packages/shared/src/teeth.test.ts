import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_TEETH,
  isToothNo,
  LOWER_ROW,
  sortTeeth,
  teethOfArch,
  teethOfQuadrant,
  toothInfo,
  UPPER_ROW,
} from './teeth.ts';

describe('FDI teeth', () => {
  it('has 32 distinct permanent teeth in viewer order, 18 first on the upper row', () => {
    assert.equal(ALL_TEETH.length, 32);
    assert.equal(new Set(ALL_TEETH).size, 32);
    assert.deepEqual(UPPER_ROW, [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]);
    assert.deepEqual(LOWER_ROW, [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]);
  });

  it('accepts only 11–18, 21–28, 31–38, 41–48', () => {
    for (const n of ALL_TEETH) assert.equal(isToothNo(n), true);
    for (const n of [0, 10, 19, 20, 29, 30, 39, 40, 49, 51, 11.5, '11', null]) assert.equal(isToothNo(n), false);
  });

  it('describes a tooth: quadrant, arch, the patient side and its kind', () => {
    assert.deepEqual(toothInfo(13), {
      no: 13,
      quadrant: 1,
      position: 3,
      arch: 'upper',
      side: 'right',
      kind: 'canine',
    });
    assert.equal(toothInfo(21).side, 'left');
    assert.equal(toothInfo(36).arch, 'lower');
    assert.equal(toothInfo(36).kind, 'firstMolar');
    assert.equal(toothInfo(48).side, 'right');
    assert.equal(toothInfo(48).kind, 'thirdMolar');
    assert.throws(() => toothInfo(19), RangeError);
  });

  it('lists quadrants and arches', () => {
    assert.deepEqual(teethOfQuadrant(2), [21, 22, 23, 24, 25, 26, 27, 28]);
    assert.equal(teethOfArch('lower').length, 16);
    assert.ok(teethOfArch('upper').every((t) => t < 30));
  });

  it('sorts and de-duplicates in chart order, dropping non-teeth', () => {
    assert.deepEqual(sortTeeth([21, 11, 48, 11, 99, 18]), [18, 11, 21, 48]);
  });
});
