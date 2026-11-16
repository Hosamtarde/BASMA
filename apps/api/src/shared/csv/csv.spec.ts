import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { BOM, CsvTable, date, empty, int, money, neutralize, text } from './csv';

describe('CsvTable', () => {
  it('starts with the UTF-8 BOM exactly once, at the byte level', () => {
    const buf = new CsvTable(['a']).toBuffer();
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buf.toString('utf8').split(BOM)).toHaveLength(2);
    expect(buf.subarray(3, 6).toString()).not.toBe(BOM);
  });

  it('uses CRLF line ends and ends with one', () => {
    const t = new CsvTable(['a', 'b']);
    t.add([text('x'), int(1)]);
    const s = t.toString();
    expect(s).toBe(`${BOM}a,b\r\nx,1\r\n`);
    expect(s.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('quotes delimiter, quote, CR and LF; doubles quotes', () => {
    const t = new CsvTable(['v']);
    for (const v of ['a,b', 'say "hi"', 'two\nlines', 'cr\rhere', 'plain']) t.add([text(v)]);
    expect(t.toString()).toBe(`${BOM}v\r\n"a,b"\r\n"say ""hi"""\r\n"two\nlines"\r\n"cr\rhere"\r\nplain\r\n`.replace('cr\rhere"', 'cr\rhere"'));
  });

  it('an empty set is the header only', () => {
    const t = new CsvTable(['x', 'y']);
    expect(t.rows).toBe(0);
    expect(t.toString()).toBe(`${BOM}x,y\r\n`);
  });

  it('round-trips Arabic, accents and emoji through UTF-8', () => {
    const t = new CsvTable(['الطبيب']);
    t.add([text('د. أحمد التجريبي ✓ 🦷 é')]);
    const back = t.toBuffer().toString('utf8');
    expect(back).toContain('الطبيب');
    expect(back).toContain('د. أحمد التجريبي ✓ 🦷 é');
  });

  it('rejects a row of the wrong width and keeps very long text intact', () => {
    const t = new CsvTable(['a', 'b']);
    expect(() => t.add([text('only one')])).toThrow(RangeError);
    const long = 'x'.repeat(50_000);
    const one = new CsvTable(['a']);
    one.add([text(long)]);
    expect(one.toString()).toContain(long);
  });

  it('counts data rows without the header', () => {
    const t = new CsvTable(['a']);
    t.add([int(1)]);
    t.add([int(2)]);
    expect(t.rows).toBe(2);
  });
});

describe('formula injection (CSV injection)', () => {
  it.each(['=1+1', '+1', '-2+3', '@SUM(A1)', '\tTAB', '\rCR'])('text %j gets a leading quote', (v) => {
    expect(neutralize(v)).toBe(`'${v}`);
    const t = new CsvTable(['v']);
    t.add([text(v)]);
    expect(t.toString().split('\r\n')[1]?.replace(/^"|"$/g, '')).toBe(`'${v}`);
  });

  it.each(['د. أحمد', '1 apple', 'Dr =x', ' =x', ''])('text %j is left alone', (v) => {
    expect(neutralize(v)).toBe(v);
  });

  it('never touches a number the server produced, so a negative amount stays a number', () => {
    const t = new CsvTable(['amount']);
    t.add([money(-5000, 2)]);
    expect(t.toString()).toBe(`${BOM}amount\r\n-50.00\r\n`);
  });
});

describe('money text (integer minor units, no floats)', () => {
  const MAX = 999_999_999_999;
  it.each([
    [0, 0, '0'],
    [5, 0, '5'],
    [0, 2, '0.00'],
    [1, 2, '0.01'],
    [99, 2, '0.99'],
    [100, 2, '1.00'],
    [12345, 2, '123.45'],
    [-5000, 2, '-50.00'],
    [-1, 2, '-0.01'],
    [5, 3, '0.005'],
    [1234567, 3, '1234.567'],
    [MAX, 2, '9999999999.99'],
    [-MAX, 2, '-9999999999.99'],
    [MAX, 3, '999999999.999'],
  ])('%i with %i decimals is %s', (minor, decimals, expected) => {
    expect(money(minor, decimals)).toEqual({ kind: 'raw', value: expected });
  });

  it('refuses a fraction or an unsafe number instead of rounding', () => {
    expect(() => money(1.5, 2)).toThrow(RangeError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, 2)).toThrow(RangeError);
    expect(() => int(0.1)).toThrow(RangeError);
  });

  it('null becomes an empty cell', () => {
    expect(money(null, 2)).toBe(empty);
    expect(int(undefined)).toBe(empty);
    expect(date(null)).toBe(empty);
  });

  it('accepts ISO dates only', () => {
    expect(date('2026-11-16')).toEqual({ kind: 'raw', value: '2026-11-16' });
    expect(() => date('16/11/2026')).toThrow(RangeError);
  });
});

describe('the export module does no floating-point money maths', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
    });
  it.each([path.join(__dirname), path.join(__dirname, '..', '..', 'modules', 'exports')])(
    'has no toFixed, parseFloat, Number("…") division or / 100 in %s',
    (dir) => {
      for (const file of walk(dir)) {
        const source = readFileSync(file, 'utf8');
        expect({ file, hit: /toFixed|parseFloat|\/\s*100\b|\/\s*1000\b|Math\.round/.test(source) }).toEqual({
          file,
          hit: false,
        });
      }
    },
  );
});
