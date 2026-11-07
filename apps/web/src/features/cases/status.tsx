import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { CaseStatus } from './api';

/**
 * Status colours (SPEC §1, §9) as static class names so Tailwind keeps them: tinted background,
 * darker text, and a dot / row bar in the exact status colour (contrast rule, SPEC §1.1).
 */
export const STATUS_STYLE: Record<CaseStatus, { badge: string; dot: string; bar: string; text: string }> = {
  waiting: {
    badge: 'bg-st-waiting-bg text-st-waiting-ink',
    dot: 'bg-st-waiting',
    bar: 'border-s-st-waiting',
    text: 'text-st-waiting-ink',
  },
  design: {
    badge: 'bg-st-design-bg text-st-design-ink',
    dot: 'bg-st-design',
    bar: 'border-s-st-design',
    text: 'text-st-design-ink',
  },
  in_progress: {
    badge: 'bg-st-in_progress-bg text-st-in_progress-ink',
    dot: 'bg-st-in_progress',
    bar: 'border-s-st-in_progress',
    text: 'text-st-in_progress-ink',
  },
  ready: {
    badge: 'bg-st-ready-bg text-st-ready-ink',
    dot: 'bg-st-ready',
    bar: 'border-s-st-ready',
    text: 'text-st-ready-ink',
  },
  delivered: {
    badge: 'bg-st-delivered-bg text-st-delivered-ink',
    dot: 'bg-st-delivered',
    bar: 'border-s-st-delivered',
    text: 'text-st-delivered-ink',
  },
  returned: {
    badge: 'bg-st-returned-bg text-st-returned-ink',
    dot: 'bg-st-returned',
    bar: 'border-s-st-returned',
    text: 'text-st-returned-ink',
  },
  cancelled: {
    badge: 'bg-st-cancelled-bg text-st-cancelled-ink',
    dot: 'bg-st-cancelled',
    bar: 'border-s-st-cancelled',
    text: 'text-st-cancelled-ink',
  },
};

export function StatusBadge({ status, className }: { status: CaseStatus; className?: string }) {
  const { t } = useTranslation();
  const style = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-bold whitespace-nowrap',
        style.badge,
        className,
      )}
    >
      <i aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', style.dot)} />
      {t(`caseStatus.${status}`)}
    </span>
  );
}

/** «⚠ متأخرة»: expected date passed and the case is still in the lab (computed by the API). */
export function OverdueMarker() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-danger-bg px-1.5 py-0.5 text-[12.5px] font-bold whitespace-nowrap text-danger">
      <TriangleAlert aria-hidden="true" className="size-3.5" />
      {t('cases.overdue')}
    </span>
  );
}
