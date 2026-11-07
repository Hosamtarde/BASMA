import { parseMoney } from '@app/shared';
import type { MoneyParseError } from '@app/shared';
import { z } from 'zod';
import { msg } from '@/lib/form-messages';
import { TextField } from './ui/field';
import type { TextFieldProps } from './ui/field';

const MESSAGE: Record<MoneyParseError, (decimals: number) => string> = {
  empty: () => msg('validation.required'),
  format: () => msg('validation.moneyFormat'),
  tooManyDecimals: (d) => msg('validation.moneyDecimals', { count: d }),
  negative: () => msg('validation.moneyNegative'),
  tooLarge: () => msg('validation.moneyTooLarge'),
};

/**
 * Zod field for a money text box: valid when it parses to integer minor units for the
 * currency's decimals (packages/shared, no floats). Transforms to minor units.
 */
export function moneySchema(decimals: number, opts: { allowNegative?: boolean; optional?: boolean } = {}) {
  return z.string().transform((text, ctx) => {
    if (opts.optional && text.trim() === '') return 0;
    const parsed = parseMoney(text, decimals, { allowNegative: opts.allowNegative ?? false });
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: MESSAGE[parsed.error](decimals) });
      return z.NEVER;
    }
    return parsed.minor;
  });
}

/** Money text box: Western digits typed LTR, the currency symbol inside it, numeric keypad hint. */
export function MoneyField({ symbol, ...props }: TextFieldProps & { symbol: string }) {
  return (
    <TextField
      inputMode="decimal"
      dir="ltr"
      autoComplete="off"
      className="num text-start"
      suffix={symbol}
      {...props}
    />
  );
}
