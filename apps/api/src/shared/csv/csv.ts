import { toMoneyInput } from '@app/shared';

/** UTF-8 byte order mark: Excel needs it to read Arabic text correctly (SPEC §10). */
export const BOM = '﻿';
export const CSV_DELIMITER = ',';
const EOL = '\r\n';

/**
 * A cell is either free text (typed by users: names, notes — never trusted) or a raw value the
 * server produced itself (an integer, a decimal money string, an ISO date). Only text is
 * neutralised against spreadsheet formula injection, so a negative amount stays a number.
 */
export type Cell = { kind: 'text'; value: string } | { kind: 'raw'; value: string };

export const text = (value: string | null | undefined): Cell => ({ kind: 'text', value: value ?? '' });
export const empty: Cell = { kind: 'raw', value: '' };

export function int(value: number | null | undefined): Cell {
  if (value === null || value === undefined) return empty;
  if (!Number.isSafeInteger(value)) throw new RangeError(`not a safe integer: ${value}`);
  return { kind: 'raw', value: String(value) };
}

/** Exact decimal text from integer minor units (string arithmetic, never a float). */
export function money(minor: number | null | undefined, decimals: number): Cell {
  if (minor === null || minor === undefined) return empty;
  if (!Number.isSafeInteger(minor)) throw new RangeError(`not a safe integer amount: ${minor}`);
  return { kind: 'raw', value: toMoneyInput(minor, decimals) };
}

export function date(value: string | null | undefined): Cell {
  if (value === null || value === undefined) return empty;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`not an ISO date: ${value}`);
  return { kind: 'raw', value };
}

/** A leading = + - @ TAB or CR makes Excel read the cell as a formula; a quote keeps it text. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralize(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function encode(cell: Cell, delimiter: string): string {
  const value = cell.kind === 'text' ? neutralize(cell.value) : cell.value;
  const needsQuotes =
    value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r');
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value;
}

/** RFC 4180 table: CRLF line ends, quotes doubled, UTF-8 BOM in front. */
export class CsvTable {
  private readonly lines: string[] = [];
  readonly columns: number;

  constructor(
    header: readonly string[],
    private readonly delimiter: string = CSV_DELIMITER,
  ) {
    this.columns = header.length;
    this.lines.push(header.map((h) => encode(text(h), this.delimiter)).join(this.delimiter));
  }

  /** Number of data rows (the header is not counted). */
  get rows(): number {
    return this.lines.length - 1;
  }

  add(cells: readonly Cell[]): void {
    if (cells.length !== this.columns) {
      throw new RangeError(`row has ${cells.length} cells, the header has ${this.columns}`);
    }
    this.lines.push(cells.map((c) => encode(c, this.delimiter)).join(this.delimiter));
  }

  /** The whole file as text, starting with the BOM. */
  toString(): string {
    return BOM + this.lines.join(EOL) + EOL;
  }

  toBuffer(): Buffer {
    return Buffer.from(this.toString(), 'utf8');
  }
}
