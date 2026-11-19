import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { ExportButton } from '@/components/ui/export-button';
import { FormDialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/field';
import { DataTable, Pager } from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import { formatNumber } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { BREAKDOWN_PAGE_SIZE, debtBreakdownQuery, exportApi } from './api';
import { BalanceText, MoneyCell } from './parts';

/**
 * «تفاصيل المبلغ» (SPEC §5.11): what makes up a doctor's balance. The numbers come from the same
 * allocation the case page uses, and the equation at the bottom is the proof the API checked
 * before answering: unpaid opening balance + remaining of every open case − credit = balance.
 */
export function DebtBreakdownDialog({
  doctor,
  page,
  onPage,
  onClose,
}: {
  doctor: { id: number; name: string };
  page: number;
  onPage: (page: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { data, isError, refetch, isFetching } = useQuery({
    ...debtBreakdownQuery(doctor.id, page),
    // A failure is shown inside the dialog (with a retry), not as a replacement of the whole page.
    throwOnError: false,
  });
  const name = data?.doctor.name ?? doctor.name;
  const settled =
    data && data.openCases.count === 0 && data.openingRemaining === 0 && data.credit === 0 && data.openRefunds.length === 0;
  const showRefunds = data !== undefined && (data.openRefunds.length > 0 || data.tieOut.refundsRemaining > 0);

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      wide
      title={t('breakdown.title', { name })}
      description={t('breakdown.intro')}
    >
      {isError && !data ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-semibold text-danger">{t('breakdown.loadError')}</p>
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !data ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <div className="flex flex-col gap-5" data-testid="debt-breakdown">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-[14px] sm:grid-cols-2" aria-label={t('breakdown.balance')}>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <dt className="font-bold text-muted">{t('breakdown.balance')}:</dt>
              <dd className="m-0 text-[18px] font-extrabold" data-testid="breakdown-balance">
                <BalanceText balance={data.figures.balance} direction={data.figures.direction} />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-bold text-muted">{t('breakdown.charges')}:</dt>
              <dd className="m-0 font-bold">
                <MoneyCell minor={data.figures.charges} />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-bold text-muted">{t('breakdown.received')}:</dt>
              <dd className="m-0 font-bold">
                <MoneyCell minor={data.figures.received} />
              </dd>
            </div>
            {data.figures.paidOut > 0 && (
              <div className="flex gap-2 sm:col-span-2" data-testid="breakdown-paid-out">
                <dt className="font-bold text-muted">{t('breakdown.paidOut')}:</dt>
                <dd className="m-0 font-bold">
                  <MoneyCell minor={data.figures.paidOut} />
                </dd>
              </div>
            )}
            {data.figures.pendingCheques > 0 && (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="font-bold text-muted">{t('breakdown.pendingCheques')}:</dt>
                <dd className="m-0 font-bold">
                  <MoneyCell minor={data.figures.pendingCheques} />
                </dd>
              </div>
            )}
          </dl>

          {settled ? (
            <p className="rounded-lg bg-success-bg px-4 py-3 font-semibold text-success-ink">{t('breakdown.nothingOwed')}</p>
          ) : (
            <section aria-label={t('breakdown.openCases')}>
              {data.openCases.count === 0 && data.credit > 0 && (
                <p className="mb-2 text-[14px] text-muted">{t('breakdown.creditOnly')}</p>
              )}
              <DataTable
                caption={t('breakdown.openCases')}
                empty={data.openCases.items.length === 0 && data.openingRemaining === 0 && data.credit === 0 && data.openRefunds.length === 0}
                emptyText={t('breakdown.nothingOwed')}
                head={
                  <>
                    <Th kind="number">{t('breakdown.caseNo')}</Th>
                    <Th>{t('breakdown.patient')}</Th>
                    <Th kind="number">{t('breakdown.receivedDate')}</Th>
                    <Th>{t('breakdown.status')}</Th>
                    <Th kind="money">{t('breakdown.total')}</Th>
                    <Th kind="money">{t('breakdown.paid')}</Th>
                    <Th kind="money">{t('breakdown.remaining')}</Th>
                  </>
                }
              >
                {page === 1 && data.openingRemaining > 0 && (
                  <tr data-row="opening">
                    <Td colSpan={6} className="font-bold">
                      {t('breakdown.openingLine')}
                    </Td>
                    <Td kind="money" className="font-extrabold">
                      <MoneyCell minor={data.openingRemaining} />
                    </Td>
                  </tr>
                )}
                {page === 1 &&
                  data.openRefunds.map((r) => (
                    <tr key={`refund-${r.id}`} data-refund={r.voucherNo}>
                      <Td kind="number">
                        <Link
                          to={`/outgoing?q=${encodeURIComponent(r.voucherNo)}`}
                          className="text-ink underline-offset-4 hover:underline"
                        >
                          {r.voucherNo}
                        </Link>
                      </Td>
                      <Td>{t('breakdown.refundLine')}</Td>
                      <Td kind="number">{r.date}</Td>
                      <Td>{t('breakdown.refundStatus')}</Td>
                      <Td kind="money">
                        <MoneyCell minor={r.amount} />
                      </Td>
                      <Td kind="money">
                        <MoneyCell minor={r.covered} />
                      </Td>
                      <Td kind="money" className="font-extrabold">
                        <MoneyCell minor={r.remaining} />
                      </Td>
                    </tr>
                  ))}
                {data.openCases.items.map((c) => (
                  <tr key={c.id} data-case={c.caseNo}>
                    <Td kind="number">
                      <Link to={`/cases/${c.id}`} className="num text-ink underline-offset-4 hover:underline">
                        {c.caseNo}
                      </Link>
                    </Td>
                    <Td autoDir>{c.patientName}</Td>
                    <Td kind="number">{c.receivedDate}</Td>
                    <Td>{t(`caseStatus.${c.status as 'waiting'}`)}</Td>
                    <Td kind="money">
                      <MoneyCell minor={c.total} />
                    </Td>
                    <Td kind="money">
                      <MoneyCell minor={c.paid} />
                    </Td>
                    <Td kind="money" className="font-extrabold">
                      <MoneyCell minor={c.remaining} />
                    </Td>
                  </tr>
                ))}
                {data.credit > 0 && (
                  <tr data-row="credit">
                    <Td colSpan={6} className="font-bold text-cyan-ink">
                      {t('breakdown.creditLine')}
                    </Td>
                    <Td kind="money" className="font-extrabold text-cyan-ink">
                      <span aria-hidden="true">−</span>
                      <span className="sr-only">{t('breakdown.eqCredit')}: </span>
                      <MoneyCell minor={data.credit} />
                    </Td>
                  </tr>
                )}
              </DataTable>
              <Pager page={page} pageSize={BREAKDOWN_PAGE_SIZE} total={data.openCases.total} onPage={onPage} />
            </section>
          )}

          <section aria-label={t('breakdown.equation')} data-testid="breakdown-equation" className="rounded-lg bg-surface px-4 py-3">
            <h3 className="mb-1 text-[14px] font-extrabold">{t('breakdown.equation')}</h3>
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[14px]">
              <span className="text-muted">{t('breakdown.eqOpening')}</span>
              <b>
                <MoneyCell minor={data.tieOut.openingRemaining} />
              </b>
              <span aria-hidden="true">+</span>
              <span className="text-muted">{t('breakdown.eqCases')}</span>
              <span className="num text-[12.5px] text-muted">({formatNumber(data.openCases.count, lang)})</span>
              <b>
                <MoneyCell minor={data.tieOut.casesRemaining} />
              </b>
              {showRefunds && (
                <>
                  <span aria-hidden="true">+</span>
                  <span className="text-muted">{t('breakdown.eqRefunds')}</span>
                  <b data-testid="breakdown-refunds-remaining">
                    <MoneyCell minor={data.tieOut.refundsRemaining} />
                  </b>
                </>
              )}
              <span aria-hidden="true">−</span>
              <span className="text-muted">{t('breakdown.eqCredit')}</span>
              <b>
                <MoneyCell minor={data.tieOut.credit} />
              </b>
              <span aria-hidden="true">=</span>
              <span className="text-muted">{t('breakdown.eqBalance')}</span>
              <b data-testid="breakdown-tie">
                <MoneyCell minor={data.tieOut.balance} />
              </b>
            </p>
          </section>

          {data.latestPayments.length > 0 && (
            <section aria-label={t('breakdown.latestPayments')}>
              <h3 className="mb-1 text-[14px] font-extrabold">{t('breakdown.latestPayments')}</h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
                {data.latestPayments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline gap-x-3">
                    <span className="num font-bold">{p.voucherNo}</span>
                    <span className="num text-muted">{p.paidAt}</span>
                    <span>{t(`payments.methods.${p.method}`)}</span>
                    {p.boundCaseNo !== null && <span className="text-muted">{t('breakdown.boundTo', { no: p.boundCaseNo })}</span>}
                    <b>
                      <MoneyCell minor={p.amount} />
                    </b>
                    {!p.counted && <span className="text-[12.5px] text-muted">{t('breakdown.notCounted')}</span>}
                  </li>
                ))}
              </ul>
              <Link
                to={`/payments?doctor=${doctor.id}`}
                className="mt-1 inline-block text-[14px] font-bold text-ink underline underline-offset-4"
              >
                {t('breakdown.allPayments')}
              </Link>
            </section>
          )}

          <div className="flex flex-wrap gap-2.5 border-t border-border pt-4">
            <Button asChild variant="primary">
              <Link to={`/doctors/${doctor.id}/statement`}>{t('breakdown.statement')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to={`/doctors/${doctor.id}`}>{t('breakdown.doctorPage')}</Link>
            </Button>
            <ExportButton needs={['ledger.read', 'cases.read']} run={() => exportApi.breakdown(doctor.id)} />
          </div>
        </div>
      )}
    </FormDialog>
  );
}
