import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { amountInWords } from './amount-words.ts';
import { MAX_AMOUNT_MINOR } from './money.ts';

const en = (minor: number, code = 'ILS', decimals = 2) => amountInWords(minor, decimals, code, 'en');
const ar = (minor: number, code = 'ILS', decimals = 2) => amountInWords(minor, decimals, code, 'ar');

describe('amountInWords — English', () => {
  it('edge amounts of the voucher brief', () => {
    assert.equal(en(1), 'Zero shekels and one agora');
    assert.equal(en(100), 'One shekel');
    assert.equal(en(100_050), 'One thousand shekels and fifty agorot');
    assert.equal(en(200_000_000), 'Two million shekels');
  });

  it('compound numbers, hyphens and plurals', () => {
    assert.equal(en(2_100), 'Twenty-one shekels');
    assert.equal(en(10_101), 'One hundred one shekels and one agora');
    assert.equal(en(1_100), 'Eleven shekels');
    assert.equal(en(99), 'Zero shekels and ninety-nine agorot');
    assert.equal(en(200), 'Two shekels');
    assert.equal(
      en(MAX_AMOUNT_MINOR),
      'Nine billion nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine shekels and ninety-nine agorot',
    );
    assert.equal(en(100_000_000_00), 'One hundred million shekels');
    assert.equal(en(1_000_000_00), 'One million shekels');
  });

  it('zero is written, not blank', () => {
    assert.equal(en(0), 'Zero shekels');
  });

  it('other known currencies and decimals', () => {
    assert.equal(en(1500, 'JOD', 3), 'One dinar and five hundred fils');
    assert.equal(en(250, 'USD'), 'Two dollars and fifty cents');
    assert.equal(en(5, 'ILS', 0), 'Five shekels');
  });

  it('an unknown currency or a decimals setting that does not fit prints the code and a fraction', () => {
    assert.equal(en(100_050, 'XYZ'), 'One thousand XYZ and 50/100');
    assert.equal(en(100_000, 'XYZ'), 'One thousand XYZ');
    assert.equal(en(1_234, 'ILS', 3), 'One ILS and 234/1000');
  });

  it('reads back to the stored amount for random amounts (independent inverse parser)', () => {
    let seed = 20_261_121;
    const next = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed;
    };
    for (let i = 0; i < 3000; i += 1) {
      const digits = (next() % 12) + 1;
      const minor = Math.min(MAX_AMOUNT_MINOR, Math.floor((next() / 4_294_967_296) * 10 ** digits));
      assert.equal(parseEnglish(en(minor)), minor, `${minor} → ${en(minor)}`);
    }
  });
});

describe('amountInWords — Arabic', () => {
  it('edge amounts of the voucher brief', () => {
    assert.equal(ar(1), 'صفر شيكل وأغورة واحدة');
    assert.equal(ar(100), 'شيكل واحد');
    assert.equal(ar(100_050), 'ألف شيكل وخمسون أغورة');
    assert.equal(ar(200_000_000), 'مليونان شيكل');
  });

  it('number and gender agreement of the counted noun', () => {
    assert.equal(ar(200), 'شيكلان');
    assert.equal(ar(300), 'ثلاثة شواكل');
    assert.equal(ar(1_100), 'أحد عشر شيكل');
    assert.equal(ar(10_000), 'مئة شيكل');
    assert.equal(ar(102), 'شيكل واحد وأغورتان');
    assert.equal(ar(503), 'خمسة شواكل وثلاث أغورات');
    assert.equal(ar(12_345), 'مئة وثلاثة وعشرون شيكل وخمس وأربعون أغورة');
  });

  it('thousands and millions', () => {
    assert.equal(ar(200_000), 'ألفان شيكل');
    assert.equal(ar(300_000), 'ثلاثة آلاف شيكل');
    assert.equal(ar(1_100_000), 'أحد عشر ألف شيكل');
    assert.equal(ar(20_000_000),'مئتا ألف شيكل');
    assert.equal(ar(100_100), 'ألف وواحد شيكل');
    assert.equal(ar(300_000_000),'ثلاثة ملايين شيكل');
    assert.equal(ar(1_000_000_00), 'مليون شيكل');
    assert.equal(ar(2_000_000_000), 'عشرون مليون شيكل');
    assert.equal(ar(1_000_000_000_00), 'مليار شيكل');
  });

  it('the largest amount', () => {
    assert.equal(
      ar(MAX_AMOUNT_MINOR),
      'تسعة مليارات وتسعمئة وتسعة وتسعون مليون وتسعمئة وتسعة وتسعون ألف وتسعمئة وتسعة وتسعون شيكل وتسع وتسعون أغورة',
    );
  });

  it('other currencies, zero decimals, fallback', () => {
    assert.equal(ar(1500, 'JOD', 3), 'دينار واحد وخمسمئة فلس');
    assert.equal(ar(5, 'ILS', 0), 'خمسة شواكل');
    assert.equal(ar(100_050, 'XYZ'), 'ألف XYZ و50/100');
    assert.equal(ar(0), 'صفر شيكل');
  });
});

describe('amountInWords — inputs', () => {
  it('refuses an amount that is not a safe non-negative integer', () => {
    assert.throws(() => en(-1), RangeError);
    assert.throws(() => en(1.5), RangeError);
    assert.throws(() => en(Number.NaN), RangeError);
    assert.throws(() => amountInWords(1, 4, 'ILS', 'en'), RangeError);
  });
});

/** Test-only inverse of the English wording for the ILS / 2-decimals case. */
function parseEnglish(text: string): number {
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const SCALE: Record<string, number> = { thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 };
  const [majorPart = '', minorPart] = text.toLowerCase().split(/ shekels? and | shekels?$/u);
  const words = (s: string): number => {
    let total = 0;
    let chunk = 0;
    for (const w of s.trim().split(/[\s-]+/u)) {
      const one = ONES.indexOf(w);
      if (one >= 0) chunk += one;
      else if (TENS.indexOf(w) > 1) chunk += TENS.indexOf(w) * 10;
      else if (w === 'hundred') chunk *= 100;
      else if (w in SCALE) {
        total += chunk * SCALE[w]!;
        chunk = 0;
      } else throw new Error(`unknown word ${w}`);
    }
    return total + chunk;
  };
  const minorText = (minorPart ?? '').replace(/ agor(a|ot)$/u, '');
  return words(majorPart) * 100 + (minorText === '' ? 0 : words(minorText));
}
