import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsAmount, IsSignedAmount } from './amount.validators';
import { MAX_AMOUNT_MINOR } from './limits';

class Amounts {
  @IsAmount() price!: number;
  @IsSignedAmount() balance!: number;
}

const errorsFor = (price: unknown, balance: unknown) =>
  validateSync(plainToInstance(Amounts, { price, balance })).map((e) => e.property);

describe('amount validators (integer minor units)', () => {
  it('accepts zero, the maximum and signed balances', () => {
    expect(errorsFor(0, -MAX_AMOUNT_MINOR)).toEqual([]);
    expect(errorsFor(MAX_AMOUNT_MINOR, MAX_AMOUNT_MINOR)).toEqual([]);
  });

  it.each([[-1], [1.5], ['100'], [MAX_AMOUNT_MINOR + 1], [Number.MAX_SAFE_INTEGER + 2], [null]])(
    'rejects price %p',
    (price) => {
      expect(errorsFor(price, 0)).toEqual(['price']);
    },
  );

  it('rejects a balance beyond the limit in either direction', () => {
    expect(errorsFor(0, -MAX_AMOUNT_MINOR - 1)).toEqual(['balance']);
    expect(errorsFor(0, 0.01)).toEqual(['balance']);
  });
});
