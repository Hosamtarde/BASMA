import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Column alignment, shared by a header and its cells so a value always sits under its header.
 * - text: names and words, at the reading start.
 * - number: phones, case numbers, dates, counts — also at the reading start; only the inline
 *   value is LTR-isolated (`num`), never the cell, so it does not drift to the other edge.
 * - money: amounts at the reading end, the currency sign after the digits.
 * - actions: row buttons and menus at the reading end, as narrow as their content.
 */
export type ColumnAlign = 'text' | 'number' | 'money' | 'actions';

const ALIGN: Record<ColumnAlign, string> = {
  text: 'text-start',
  number: 'text-start',
  money: 'text-end whitespace-nowrap',
  actions: 'w-0 text-end whitespace-nowrap',
};

export function Th({
  kind = 'text',
  className,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { kind?: ColumnAlign }) {
  return (
    <th scope="col" data-align={kind} className={cn(ALIGN[kind], className)} {...rest}>
      {children}
    </th>
  );
}

export function Td({
  kind = 'text',
  autoDir = false,
  className,
  children,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  kind?: ColumnAlign;
  /** User-entered text (names, notes): its own direction on the inline value only. */
  autoDir?: boolean;
}) {
  let content: ReactNode = children;
  const plain = typeof children === 'string' || typeof children === 'number';
  // Plain values are isolated here; richer content isolates its own value (e.g. <Money>).
  if ((kind === 'number' || kind === 'money') && plain) content = <span className="num">{children}</span>;
  else if (kind === 'actions')
    content = <div className="flex items-center justify-end gap-1">{children}</div>;
  else if (autoDir) content = <span dir="auto">{children}</span>;
  return (
    <td data-align={kind} className={cn(ALIGN[kind], className)} {...rest}>
      {content}
    </td>
  );
}

/** An amount with the currency sign after it, kept together and LTR-isolated in both languages. */
export function Money({ value, symbol }: { value: string; symbol: string }) {
  return (
    <span className="num whitespace-nowrap">
      {symbol ? `${value} ${symbol}` : value}
    </span>
  );
}
