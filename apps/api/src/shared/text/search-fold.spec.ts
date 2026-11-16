import { foldText, searchTokens } from './search-fold';

describe('foldText (search only)', () => {
  it.each([
    ['أحمد', 'احمد'],
    ['إيمان', 'ايمان'],
    ['آمنة', 'امنه'],
    ['فاطمة', 'فاطمه'],
    ['فاطمه', 'فاطمه'],
    ['مصطفى', 'مصطفي'],
    ['مُحَمَّد', 'محمد'],
    ['مـحـمـد', 'محمد'],
    ['Dr ÉMILE  Smith', 'dr émile smith'],
    ['  د.   أحمد  ', 'د. احمد'],
  ])('%s → %s', (input, expected) => {
    expect(foldText(input)).toBe(expected);
  });

  it('two spellings that differ only by hamza, ta marbuta or tashkeel fold to the same text', () => {
    expect(foldText('أحمد')).toBe(foldText('احمد'));
    expect(foldText('فاطمة')).toBe(foldText('فاطمه'));
    expect(foldText('مهى')).toBe(foldText('مهي'));
    expect(foldText('سلمى التجربة')).toBe(foldText('سلمي التجربه'));
  });

  it('is idempotent and keeps unrelated letters (ب ≠ ت, ي ≠ ا)', () => {
    for (const s of ['أحمد الخطيب', 'فاطمة', 'Dr Smith', 'مصطفى', '']) expect(foldText(foldText(s))).toBe(foldText(s));
    expect(foldText('بسمة')).not.toBe(foldText('تسمة'));
    expect(foldText('علي')).not.toBe(foldText('علا'));
  });
});

describe('searchTokens', () => {
  it('keeps words of two or more characters, once each', () => {
    expect(searchTokens('محمد علي محمد')).toEqual(['محمد', 'علي']);
    expect(searchTokens('د محمد')).toEqual(['محمد']);
    expect(searchTokens('a')).toEqual([]);
  });
});
