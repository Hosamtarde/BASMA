import type { MoneyParseError } from '@app/shared';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { moneyErrorMessage } from '@/components/money-field';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/list';
import { Money, Td, Th } from '@/components/ui/table';
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
          <Th>{t('newCase.position')}</Th>
          <Th>{t('newCase.workType')}</Th>
          <Th kind="money">{t('newCase.price')}</Th>
          <Th>{t('newCase.manualPrice')}</Th>
          <Th kind="actions">
            <span className="sr-only">{t('list.actions')}</span>
          </Th>
        </>
      }
    >
      {lines.map((l) => {
        const p = previewPrice(l, special, currency.decimals);
        const err = errors.get(l.key);
        const lineName = name(l);
        return (
          <tr key={l.key}>
            <Td className="whitespace-nowrap">
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
            </Td>
            <Td>
              <span dir="auto" className="block">
                {l.workTypeName}
              </span>
              {l.shade && (
                <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">
                  <ShadeSwatch color={shadeColor(l.shade)} className="h-4 w-3" />
                  <span className="sr-only">{t('shade.field')}</span>
                  <span className="num">{l.shade}</span>
                </span>
              )}
            </Td>
            <Td kind="money">
              {p.ok ? (
                <span className="flex flex-col items-end leading-tight">
                  <span className="font-bold">
                    <Money value={currency.format(p.minor)} symbol={currency.symbol} />
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
            </Td>
            <Td>
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
                className="num h-9 w-24 rounded-lg border border-control bg-card px-2.5 text-start outline-none focus-visible:outline-2 focus-visible:outline-focus aria-[invalid=true]:border-danger"
              />
              {err && (
                <p id={`price-error-${l.key}`} className="mt-1 text-[12.5px] font-semibold text-danger">
                  {renderMessage(t, moneyErrorMessage(err, currency.decimals))}
                </p>
              )}
            </Td>
            <Td kind="actions">
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('newCase.removeLine', { line: lineName })}
                onClick={() => onRemove(l.key)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </Td>
          </tr>
        );
      })}
    </DataTable>
  );
}
