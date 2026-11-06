import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { containsPattern, IsName, normalizeName, normalizeOptionalText } from './names';

class Named {
  @IsName()
  name!: string;
}

const check = (name: unknown) => {
  const dto = plainToInstance(Named, { name });
  return { dto, errors: validateSync(dto) };
};

describe('normalizeName', () => {
  it('trims and collapses repeated whitespace of any kind', () => {
    expect(normalizeName('  Dr.\t Ahmad \n  Saleh  ')).toBe('Dr. Ahmad Saleh');
  });

  it('applies Unicode NFC (decomposed and composed forms become equal)', () => {
    expect(normalizeName('Café')).toBe('Café');
  });

  it('does not fold Arabic letter variants (owner decision)', () => {
    expect(normalizeName('أحمد')).not.toBe(normalizeName('احمد'));
    expect(normalizeName('  د.  أحمد  ')).toBe('د. أحمد');
  });
});

describe('IsName', () => {
  it('accepts and normalizes a valid name', () => {
    const { dto, errors } = check('  زيركون   شفاف ');
    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('زيركون شفاف');
  });

  it.each([[''], ['   '], ['x'.repeat(101)], [42], ['bad\u0000name']])('rejects %p', (value) => {
    expect(check(value).errors).not.toHaveLength(0);
  });
});

describe('normalizeOptionalText', () => {
  it('turns blank into null and trims the rest', () => {
    expect(normalizeOptionalText('   ')).toBeNull();
    expect(normalizeOptionalText(' 059 ')).toBe('059');
    expect(normalizeOptionalText(undefined)).toBeUndefined();
  });
});

describe('containsPattern', () => {
  it('escapes LIKE wildcards so they match literally', () => {
    expect(containsPattern('50%_off\\x')).toBe('%50\\%\\_off\\\\x%');
  });
});
