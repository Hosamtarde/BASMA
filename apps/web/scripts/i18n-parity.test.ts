import { describe, expect, it } from 'vitest';
import { checkParity } from './i18n-parity.ts';

const AR_HINT = {
  hint_zero: 'لا شيء',
  hint_one: 'واحد',
  hint_two: 'اثنان',
  hint_few: '{{count}} أحرف',
  hint_many: '{{count}} حرفًا',
  hint_other: '{{count}} حرف',
};
const EN_HINT = { hint_one: '{{count}} character', hint_other: '{{count}} characters' };

describe('i18n parity', () => {
  it('accepts matching catalogs where Arabic has six plural forms and English two', () => {
    expect(checkParity({ ar: { a: { b: 'نص' }, ...AR_HINT }, en: { a: { b: 'text' }, ...EN_HINT } })).toEqual(
      [],
    );
  });

  it('allows an optional _zero form in English', () => {
    expect(checkParity({ ar: AR_HINT, en: { ...EN_HINT, hint_zero: 'none' } })).toEqual([]);
  });

  it('reports a key missing in one language', () => {
    expect(checkParity({ ar: { a: 'x', b: 'y' }, en: { a: 'x' } })).toEqual([
      'b: missing in en (present in ar)',
    ]);
  });

  it('reports missing Arabic plural forms and forms English does not use', () => {
    const problems = checkParity({
      ar: { hint_one: 'واحد', hint_other: '{{count}}' },
      en: { hint_one: '{{count}}', hint_other: '{{count}}', hint_few: '{{count}}' },
    });
    expect(problems).toEqual([
      '[ar] hint: missing plural forms few, many, two, zero',
      '[en] hint: plural forms not used by en: few',
    ]);
  });

  it('reports an entry that is plural in one language only', () => {
    const problems = checkParity({
      ar: { n: '{{count}}' },
      en: { n_one: '{{count}}', n_other: '{{count}}' },
    });
    expect(problems).toContain('n: plural in some languages but not in others');
  });

  it('reports different placeholders and empty texts', () => {
    expect(checkParity({ ar: { w: 'أهلًا {{name}}', e: ' ' }, en: { w: 'Hello {{user}}', e: 'x' } })).toEqual(
      ['[ar] e: empty text', 'w: placeholders differ (ar: {name}; en: {user})'],
    );
  });
});
