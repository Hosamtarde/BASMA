import { Ban, CalendarClock, CircleCheck, Clock, RotateCcw, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Money } from '@/components/ui/table';
import { useCurrency } from '@/features/shell/currency';
import { cn } from '@/lib/cn';
import type { Cheque, ChequeStatus, DoctorBalance, Payment } from './api';

const badge = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-bold whitespace-nowrap [&_svg]:size-3.5';

const CHEQUE_STYLE: Record<ChequeStatus, string> = {
  pending: 'bg-st-waiting-bg text-st-waiting-ink',
  cleared: 'bg-st-ready-bg text-st-ready-ink',
  returned: 'bg-st-returned-bg text-st-returned-ink',
};
const CHEQUE_ICON = { pending: Clock, cleared: CircleCheck, returned: RotateCcw } as const;

/** Cheque status: colour plus icon plus the word, never colour alone. */
export function ChequeStatusBadge({ status }: { status: ChequeStatus }) {
  const { t } = useTranslation();
  const Icon = CHEQUE_ICON[status];
  return (
    <span className={cn(badge, CHEQUE_STYLE[status])}>
      <Icon aria-hidden="true" />
      {t(`cheques.${status}`)}
    </span>
  );
}

/** «قيد التحصيل» due markers: a cheque due within 7 days, and a pending one past due. */
export function DueMarker({ cheque }: { cheque: Cheque }) {
  const { t } = useTranslation();
  if (cheque.dueState === 'none') return null;
  const overdue = cheque.dueState === 'overdue';
  return (
    <span
      data-due={cheque.dueState}
      className={cn(
        badge,
        overdue ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning-ink',
      )}
    >
      {overdue ? <TriangleAlert aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
      {overdue ? t('cheques.overdueMarker') : t('cheques.soonMarker')}
    </span>
  );
}

/** Payment status: cancelled shows the word and an icon; an active cheque shows its own status. */
export function PaymentStatusBadge({ payment }: { payment: Pick<Payment, 'status' | 'cheque'> }) {
  const { t } = useTranslation();
  if (payment.status === 'void') {
    return (
      <span className={cn(badge, 'bg-st-cancelled-bg text-st-cancelled-ink')}>
        <Ban aria-hidden="true" />
        {t('payments.statusVoid')}
      </span>
    );
  }
  if (payment.cheque) return <ChequeStatusBadge status={payment.cheque.status} />;
  return (
    <span className={cn(badge, 'bg-st-ready-bg text-st-ready-ink')}>
      <CircleCheck aria-hidden="true" />
      {t('payments.statusActive')}
    </span>
  );
}

/** An amount with the currency sign, kept together and LTR-isolated (use in a `money` cell). */
export function MoneyCell({ minor, className }: { minor: number; className?: string }) {
  const currency = useCurrency();
  return (
    <span className={className}>
      <Money value={currency.format(minor)} symbol={currency.symbol} />
    </span>
  );
}

/** A balance with its direction in words: «مستحق للمختبر» / «مستحق على المختبر» / «مسدَّد». */
export function BalanceText({ balance, direction }: Pick<DoctorBalance, 'balance' | 'direction'>) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const label =
    direction === 'owed_to_lab'
      ? t('balance.toLab')
      : direction === 'owed_by_lab'
        ? t('balance.byLab')
        : t('balance.settled');
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <Money value={currency.format(Math.abs(balance))} symbol={currency.symbol} />
      <span
        className={cn(
          'text-[13px] font-bold',
          direction === 'owed_to_lab' && 'text-warning-ink',
          direction === 'owed_by_lab' && 'text-cyan-ink',
          direction === 'settled' && 'text-success-ink',
        )}
      >
        {label}
      </span>
    </span>
  );
}
