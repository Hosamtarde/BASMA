import { parseMoney, sumMinor } from '@app/shared';
import type { CaseArea, MoneyParseError } from '@app/shared';
import type { CaseLineInput } from './api';

/**
 * Work lines of a case that is not saved yet (SPEC §5.3). The browser only previews prices; on
 * save the API resolves each price itself (special → general, or the manual price) and returns
 * the frozen snapshot (SPEC §7.5).
 */
export interface DraftLine {
  key: string;
  /** Exactly one of toothNo / area. */
  toothNo: number | null;
  area: CaseArea | null;
  workTypeId: number;
  workTypeName: string;
  /** General price of the work type when the line was added (preview only). */
  generalPrice: number;
  shade: string | null;
  /** What the user typed as a manual price; '' = let the server resolve it. */
  manualPrice: string;
}

export interface PickedWork {
  id: number;
  name: string;
  unitPrice: number;
}

let seq = 0;
const nextKey = () => `l${++seq}`;

/** One line per selected tooth (in chart order), all with the same work type and shade. */
export function linesForTeeth(teeth: readonly number[], work: PickedWork, shade: string | null): DraftLine[] {
  return teeth.map((toothNo) => ({
    key: nextKey(),
    toothNo,
    area: null,
    workTypeId: work.id,
    workTypeName: work.name,
    generalPrice: work.unitPrice,
    shade,
    manualPrice: '',
  }));
}

export function lineForArea(area: CaseArea, work: PickedWork, shade: string | null): DraftLine {
  return {
    key: nextKey(),
    toothNo: null,
    area,
    workTypeId: work.id,
    workTypeName: work.name,
    generalPrice: work.unitPrice,
    shade,
    manualPrice: '',
  };
}

export type PriceSource = 'general' | 'special' | 'manual';
export type PricePreview =
  | { ok: true; minor: number; source: PriceSource }
  | { ok: false; error: MoneyParseError };

/** Special prices of the chosen doctor by work type id (null = none). */
export type SpecialPrices = ReadonlyMap<number, number | null>;

export function previewPrice(line: DraftLine, special: SpecialPrices, decimals: number): PricePreview {
  if (line.manualPrice.trim() !== '') {
    const parsed = parseMoney(line.manualPrice, decimals);
    return parsed.ok ? { ok: true, minor: parsed.minor, source: 'manual' } : parsed;
  }
  const s = special.get(line.workTypeId);
  return s === undefined || s === null
    ? { ok: true, minor: line.generalPrice, source: 'general' }
    : { ok: true, minor: s, source: 'special' };
}

/** Preview subtotal, or null while a manual price is not a valid amount. */
export function previewSubtotal(lines: readonly DraftLine[], special: SpecialPrices, decimals: number): number | null {
  const prices = lines.map((l) => previewPrice(l, special, decimals));
  if (prices.some((p) => !p.ok)) return null;
  return sumMinor(prices.map((p) => (p.ok ? p.minor : 0)));
}

/**
 * Lines for POST /cases: the manual price only when one was typed (never a previewed price, so
 * the server resolves special/general itself). Invalid manual prices are reported by line key.
 */
export function toLineInputs(
  lines: readonly DraftLine[],
  decimals: number,
): { ok: true; lines: CaseLineInput[] } | { ok: false; errors: Map<string, MoneyParseError> } {
  const errors = new Map<string, MoneyParseError>();
  const out: CaseLineInput[] = [];
  for (const l of lines) {
    const input: CaseLineInput = {
      workTypeId: l.workTypeId,
      shade: l.shade,
      ...(l.toothNo !== null ? { toothNo: l.toothNo } : { area: l.area ?? 'none' }),
    };
    if (l.manualPrice.trim() !== '') {
      const parsed = parseMoney(l.manualPrice, decimals);
      if (!parsed.ok) errors.set(l.key, parsed.error);
      else input.unitPrice = parsed.minor;
    }
    out.push(input);
  }
  return errors.size > 0 ? { ok: false, errors } : { ok: true, lines: out };
}

/**
 * Colours for work types on the chart, in order of first use, so a tooth with work shows its
 * work type's colour (SPEC §5.3). Dark enough for white digits on the badges (WCAG AA).
 */
export const WORK_COLORS = ['#a65f0c', '#6a4bd8', '#0b7a6b', '#b8325e', '#56701a', '#4f5d67'] as const;

export function workColors(lines: readonly { workTypeId: number }[]): Map<number, string> {
  const colors = new Map<number, string>();
  for (const l of lines) {
    if (!colors.has(l.workTypeId)) {
      colors.set(l.workTypeId, WORK_COLORS[colors.size % WORK_COLORS.length] as string);
    }
  }
  return colors;
}

export interface ToothWork {
  color: string;
  names: string[];
}

/** Teeth that already have lines: the first line's colour and every work type name on it. */
export function teethWork(
  lines: readonly { toothNo: number | null; workTypeId: number; workTypeName: string }[],
  colors: ReadonlyMap<number, string>,
): Map<number, ToothWork> {
  const out = new Map<number, ToothWork>();
  for (const l of lines) {
    if (l.toothNo === null) continue;
    const entry = out.get(l.toothNo);
    if (entry) {
      if (!entry.names.includes(l.workTypeName)) entry.names.push(l.workTypeName);
    } else {
      out.set(l.toothNo, { color: colors.get(l.workTypeId) ?? (WORK_COLORS[0]), names: [l.workTypeName] });
    }
  }
  return out;
}
