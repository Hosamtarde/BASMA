import type { MoneyParseError } from '@app/shared';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { moneyErrorMessage } from '@/components/money-field';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/list';
import { useCurrency } from '@/features/shell/currency';
import { cn } from '@/lib/cn';
import { renderMessage } from '@/lib/form-messages';
import { previewPrice } from './draft';
import type { DraftLine, SpecialPrices } from './draft';
import { ShadeSwatch } from './shade/ShadeGuideDialog';
import { shadeColor } from './shade/shades';

/** «سن 13 · زيركون» — how a line is named in labels and buttons. */
export function useLineName() {
  const { t } = useTranslation();
  return (l: { toothNo: number | null; area: string | null; workTypeName: string }) =>
    `${l.toothNo !== null ? t('newCase.tooth', { no: l.toothNo }) : t(`caseArea.${(l.area ?? 'none') as 'none'}`)} · ${l.workTypeName}`;
}

/**
 * Lines of the case being added: preview price (labelled general / ★ special / manual) and a
 * manual price box per line. The server resolves and freezes the real prices on save.
 */
export function DraftLinesTable({
  lines,
  special,
  colors,
  errors,
  onManualPrice,
  onRemove,
}: {
  lines: DraftLine[];
  special: SpecialPrices;
  colors: ReadonlyMap<number, string>;
  errors: ReadonlyMap<string, MoneyParseError>;
  onManualPrice: (key: string, text: string) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const name = useLineName();
  return (
    <DataTable
      caption={t('newCase.lines')}
      empty={lines.length === 0}
      emptyText={t('newCase.linesEmpty')}
      head={
        <>
          <th scope="col">{t('newCase.position')}</th>
          <th scope="col">{t('newCase.workType')}</th>
          <th scope="col">{t('shade.field')}</th>
          <th scope="col">{t('newCase.price')}</th>
          <th scope="col">{t('newCase.manualPrice')}</th>
          <th scope="col" className="w-0">
            <span className="sr-only">{t('list.actions')}</span>
          </th>
        </>
      }
    >
      {lines.map((l) => {
        const p = previewPrice(l, special, currency.decimals);
        const err = errors.get(l.key);
        const lineName = name(l);
        return (
          <tr key={l.key}>
            <td className="whitespace-nowrap">
              <span className="inline-flex items-center gap-2">
                <i
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ background: colors.get(l.workTypeId) }}
                />
                {l.toothNo !== null ? (
                  <span className="num font-extrabold">{l.toothNo}</span>
                ) : (
                  <span className="font-bold">{t(`caseArea.${l.area ?? 'none'}`)}</span>
                )}
              </span>
            </td>
            <td dir="auto">{l.workTypeName}</td>
            <td>
              <span className="inline-flex items-center gap-1.5">
                {l.shade && <ShadeSwatch color={shadeColor(l.shade)} className="h-5 w-4" />}
                <span className="num">{l.shade ?? '—'}</span>
              </span>
            </td>
            <td className="whitespace-nowrap">
              {p.ok ? (
                <span className="flex flex-col leading-tight">
                  <span className="num font-bold">
                    {currency.format(p.minor)} {currency.symbol}
                  </span>
                  <span
                    className={cn(
                      'text-[12px]',
                      p.source === 'special' ? 'font-bold text-warning-ink' : 'text-muted',
                    )}
                  >
                    {t(`priceSource.${p.source}`)}
                  </span>
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </td>
            <td className="min-w-[120px]">
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                value={l.manualPrice}
                aria-label={t('newCase.manualPriceFor', { line: lineName })}
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? `price-error-${l.key}` : undefined}
                onChange={(e) => onManualPrice(l.key, e.target.value)}
                className="num h-9 w-full rounded-lg border border-control bg-card px-2.5 text-start outline-none focus-visible:outline-2 focus-visible:outline-focus aria-[invalid=true]:border-danger"
              />
              {err && (
                <p id={`price-error-${l.key}`} className="mt-1 text-[12.5px] font-semibold text-danger">
                  {renderMessage(t, moneyErrorMessage(err, currency.decimals))}
                </p>
              )}
            </td>
            <td>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('newCase.removeLine', { line: lineName })}
                onClick={() => onRemove(l.key)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
