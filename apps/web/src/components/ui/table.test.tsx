import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Money, Td, Th } from './table';
import type { ColumnAlign } from './table';

function Table({ kind, value }: { kind: ColumnAlign; value: React.ReactNode }) {
  return (
    <table>
      <thead>
        <tr>
          <Th kind={kind}>head</Th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <Td kind={kind}>{value}</Td>
        </tr>
      </tbody>
    </table>
  );
}

describe('Th / Td alignment variants', () => {
  it.each([
    ['text', 'text-start'],
    ['number', 'text-start'],
    ['money', 'text-end'],
    ['actions', 'text-end'],
  ] as const)('%s: the header and its cells share %s', (kind, cls) => {
    render(<Table kind={kind} value="0599 123 456" />);
    const th = screen.getByRole('columnheader');
    const td = screen.getByRole('cell');
    expect(th).toHaveClass(cls);
    expect(td).toHaveClass(cls);
    expect(th.dataset.align).toBe(kind);
    expect(td.dataset.align).toBe(kind);
  });

  it('a number keeps LTR on the inline value only, never on the cell (no drift to the far edge)', () => {
    render(<Table kind="number" value="0599 123 456" />);
    const td = screen.getByRole('cell');
    expect(td).not.toHaveClass('num');
    expect(td).not.toHaveAttribute('dir');
    expect(within(td).getByText('0599 123 456')).toHaveClass('num');
  });

  it('user-entered text gets its own direction on an inner span, not on the cell', () => {
    render(
      <table>
        <tbody>
          <tr>
            <Td autoDir>ليلى حداد</Td>
          </tr>
        </tbody>
      </table>,
    );
    const td = screen.getByRole('cell');
    expect(td).not.toHaveAttribute('dir');
    expect(within(td).getByText('ليلى حداد')).toHaveAttribute('dir', 'auto');
  });

  it('money: digits and sign kept together, sign after the digits, LTR-isolated', () => {
    render(<Table kind="money" value={<Money value="1,200.00" symbol="₪" />} />);
    const amount = within(screen.getByRole('cell')).getByText('1,200.00 ₪');
    expect(amount).toHaveClass('num', 'whitespace-nowrap');
    // One text run: the sign never splits from the digits or lands before them.
    expect(amount.childNodes).toHaveLength(1);
  });
});
