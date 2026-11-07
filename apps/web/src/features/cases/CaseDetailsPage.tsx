import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Ban, ListPlus, Pencil, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { NotFoundPage } from '@/app/errors';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/field';
import { Card, DataTable } from '@/components/ui/list';
import { Money, Td, Th } from '@/components/ui/table';
import { useCurrency } from '@/features/shell/currency';
import { settingsQuery } from '@/features/shell/settings';
import { formatDateTimeIn, todayIn } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';
import { caseApi, caseQuery, storeCase } from './api';
import type { CaseDetail, CaseLine } from './api';
import { AddLinesDialog, CancelCaseDialog, EditCaseDialog, LineDialog, StatusDialog } from './CaseDialogs';
import { useLineName } from './DraftLinesTable';
import { ShadeSwatch } from './shade/ShadeGuideDialog';
import { shadeColor } from './shade/shades';
import { OverdueMarker, STATUS_STYLE, StatusBadge } from './status';

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[13px] font-bold text-muted">{label}</dt>
      <dd className="min-w-0 font-bold">{children}</dd>
    </div>
  );
}

/**
 * «تفاصيل الحالة» (SPEC §5.6). What may be done comes from the API (allowedStatuses, canEdit,
 * canCancel); every write sends the rowVersion of the last answer and stores the new one.
 */
export function CaseDetailsPage() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const valid = Number.isSafeInteger(id) && id > 0;
  const { data: detail } = useQuery({ ...caseQuery(id), enabled: valid });
  const { data: settings } = useQuery(settingsQuery);
  const timeZone = settings?.labProfile?.timeZone ?? 'UTC';
  const Back = currentLanguage() === 'ar' ? ArrowRight : ArrowLeft;
  const [dialog, setDialog] = useState<'status' | 'cancel' | 'edit' | 'lines' | null>(null);

  if (!valid) return <NotFoundPage />;
  if (!detail) return <Spinner label={t('common.loading')} />;
  const today = todayIn(timeZone);
  const close = (o: boolean) => !o && setDialog(null);

  return (
    <>
      <Link
        to="/cases"
        className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-bold text-cyan-ink no-underline hover:underline"
      >
        <Back aria-hidden="true" className="size-4" />
        {t('caseDetails.back')}
      </Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-[24px] leading-tight font-extrabold">
          {t('caseDetails.title', { no: detail.caseNo })}
        </h1>
        <StatusBadge status={detail.status} />
        {detail.overdue && <OverdueMarker />}
        <span className="flex-1" />
        <div className="flex flex-wrap gap-2">
          {detail.allowedStatuses.some((s) => s !== 'cancelled') && (
            <Button onClick={() => setDialog('status')}>
              <Repeat aria-hidden="true" />
              {t('caseDetails.changeStatus')}
            </Button>
          )}
          {detail.canEdit && (
            <Button variant="secondary" onClick={() => setDialog('edit')}>
              <Pencil aria-hidden="true" />
              {t('caseDetails.edit')}
            </Button>
          )}
          {detail.canCancel && (
            <Button variant="danger" onClick={() => setDialog('cancel')}>
              <Ban aria-hidden="true" />
              {t('caseDetails.cancelCase')}
            </Button>
          )}
        </div>
      </div>
      {detail.status === 'cancelled' && (
        <p
          role="note"
          className="mb-4 rounded-lg bg-st-cancelled-bg px-4 py-2.5 font-semibold text-st-cancelled-ink"
        >
          {t('caseDetails.cancelledNote')}
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className={cn('border-s-4', STATUS_STYLE[detail.status].bar)}>
            <h2 className="sr-only">{t('caseDetails.header')}</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
              <Info label={t('caseDetails.doctor')}>
                <Link
                  to={`/doctors/${detail.doctor.id}`}
                  dir="auto"
                  className="text-ink underline-offset-4 hover:underline"
                >
                  {detail.doctor.name}
                </Link>
              </Info>
              <Info label={t('caseDetails.patient')}>
                <span dir="auto">{detail.patientName}</span>
              </Info>
              <Info label={t('caseDetails.technician')}>
                <span dir="auto">{detail.technician?.name ?? '—'}</span>
              </Info>
              <Info label={t('caseDetails.received')}>
                <span className="num">{detail.receivedDate}</span>
              </Info>
              <Info label={t('caseDetails.expected')}>
                <span className="num">{detail.expectedDate}</span>
              </Info>
              {detail.deliveredDate && (
                <Info label={t('caseDetails.delivered')}>
                  <span className="num">{detail.deliveredDate}</span>
                </Info>
              )}
            </dl>
          </Card>
          <LinesCard detail={detail} onAdd={() => setDialog('lines')} />
          <Card>
            <h2 className="mb-2 text-[17px] font-extrabold">{t('caseDetails.notes')}</h2>
            {detail.notes ? (
              <p dir="auto" className="whitespace-pre-wrap">
                {detail.notes}
              </p>
            ) : (
              <p className="text-muted">{t('caseDetails.noNotes')}</p>
            )}
          </Card>
        </div>
        <History detail={detail} timeZone={timeZone} />
      </div>

      <StatusDialog detail={detail} today={today} open={dialog === 'status'} onOpenChange={close} />
      <CancelCaseDialog detail={detail} open={dialog === 'cancel'} onOpenChange={close} />
      <EditCaseDialog detail={detail} today={today} open={dialog === 'edit'} onOpenChange={close} />
      <AddLinesDialog detail={detail} open={dialog === 'lines'} onOpenChange={close} />
    </>
  );
}

function LinesCard({ detail, onAdd }: { detail: CaseDetail; onAdd: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const name = useLineName();
  const [editing, setEditing] = useState<CaseLine | null>(null);
  const [removing, setRemoving] = useState<CaseLine | null>(null);
  const remove = useMutation({
    mutationFn: (l: CaseLine) => caseApi.removeLine(detail.id, l.id, detail.rowVersion),
    onSuccess: async (saved) => {
      await storeCase(queryClient, saved);
      toast.success(t('caseDetails.deleteLineDialog.done'));
      setRemoving(null);
    },
  });

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[17px] font-extrabold">{t('caseDetails.lines')}</h2>
        <span className="flex-1" />
        {detail.canEdit && (
          <Button variant="secondary" size="sm" onClick={onAdd}>
            <ListPlus aria-hidden="true" />
            {t('caseDetails.addLines')}
          </Button>
        )}
      </div>
      <DataTable
        caption={t('caseDetails.lines')}
        empty={detail.lines.length === 0}
        emptyText={t('newCase.linesEmpty')}
        head={
          <>
            <Th>{t('newCase.position')}</Th>
            <Th>{t('newCase.workType')}</Th>
            <Th>{t('shade.field')}</Th>
            <Th>{t('caseDetails.lineNote')}</Th>
            <Th kind="money">{t('newCase.price')}</Th>
            {detail.canEdit && (
              <Th kind="actions">
                <span className="sr-only">{t('list.actions')}</span>
              </Th>
            )}
          </>
        }
      >
        {detail.lines.map((l) => (
          <tr key={l.id}>
            <Td className="whitespace-nowrap">
              {l.toothNo !== null ? (
                <span className="num font-extrabold">{l.toothNo}</span>
              ) : (
                <span className="font-bold">{t(`caseArea.${l.area ?? 'none'}`)}</span>
              )}
            </Td>
            <Td autoDir>{l.workTypeName}</Td>
            <Td>
              <span className="inline-flex items-center gap-1.5">
                {l.shade && <ShadeSwatch color={shadeColor(l.shade)} className="h-5 w-4" />}
                <span className="num">{l.shade ?? '—'}</span>
              </span>
            </Td>
            <Td autoDir className="text-muted">
              {l.note ?? ''}
            </Td>
            <Td kind="money">
              <span className="flex flex-col items-end leading-tight">
                <span className="font-bold">
                  <Money value={currency.format(l.unitPrice)} symbol={currency.symbol} />
                </span>
                <span
                  className={cn(
                    'text-[12px]',
                    l.priceSource === 'special' ? 'font-bold text-warning-ink' : 'text-muted',
                  )}
                >
                  {t(`priceSource.${l.priceSource}`)}
                </span>
              </span>
            </Td>
            {detail.canEdit && (
              <Td kind="actions">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('caseDetails.editLine', { line: name(l) })}
                  onClick={() => setEditing(l)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('caseDetails.deleteLine', { line: name(l) })}
                  onClick={() => setRemoving(l)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </Td>
            )}
          </tr>
        ))}
      </DataTable>
      <dl className="ms-auto mt-3 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[14.5px]">
        <dt className="text-muted">{t('caseDetails.subtotal')}</dt>
        <dd className="text-end font-bold">
          <Money value={currency.format(detail.subtotal)} symbol={currency.symbol} />
        </dd>
        <dt className="text-muted">{t('caseDetails.discount')}</dt>
        <dd className="text-end font-bold">
          <Money value={currency.format(detail.discount)} symbol={currency.symbol} />
        </dd>
        <dt className="text-[16px] font-extrabold">{t('caseDetails.total')}</dt>
        <dd
          className={cn(
            'text-end text-[17px] font-extrabold',
            detail.status === 'cancelled' && 'text-muted line-through',
          )}
          data-testid="case-total"
        >
          <Money value={currency.format(detail.total)} symbol={currency.symbol} />
        </dd>
      </dl>
      <p className="mt-2 text-[13px] text-muted">{t('caseDetails.paymentsLater')}</p>
      <LineDialog
        detail={detail}
        line={editing}
        title={editing ? name(editing) : ''}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? t('caseDetails.deleteLineDialog.title', { line: name(removing) }) : ''}
        body={t('caseDetails.deleteLineDialog.body')}
        confirmLabel={t('common.delete')}
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </Card>
  );
}

function History({ detail, timeZone }: { detail: CaseDetail; timeZone: string }) {
  const { t } = useTranslation();
  // Newest first.
  const entries = [...detail.history].reverse();
  return (
    <Card>
      <h2 className="mb-3 text-[17px] font-extrabold">{t('caseDetails.history')}</h2>
      <ol className="flex flex-col">
        {entries.map((h, i) => (
          <li key={`${h.at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
            <span aria-hidden="true" className="flex flex-col items-center">
              <i className={cn('mt-1.5 size-3 shrink-0 rounded-full', STATUS_STYLE[h.toStatus].dot)} />
              {i < entries.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-bold">
                {h.fromStatus === null
                  ? t('caseDetails.historyCreated', { status: t(`caseStatus.${h.toStatus}`) })
                  : t('caseDetails.historyChanged', {
                      from: t(`caseStatus.${h.fromStatus}`),
                      to: t(`caseStatus.${h.toStatus}`),
                    })}
              </span>
              <span className="num text-[13px] text-muted">{formatDateTimeIn(h.at, timeZone)}</span>
              {h.deliveredDate && (
                <span className="text-[13px]">
                  {t('caseDetails.historyDelivered', { date: h.deliveredDate })}
                </span>
              )}
              {h.note && (
                <span dir="auto" className="text-[13.5px] whitespace-pre-wrap">
                  {h.note}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
