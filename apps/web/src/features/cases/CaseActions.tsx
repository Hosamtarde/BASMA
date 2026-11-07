import { useQuery } from '@tanstack/react-query';
import { Ban, EllipsisVertical, ExternalLink, Pencil, Repeat } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/field';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { caseQuery } from './api';
import { CancelCaseDialog, StatusDialog } from './CaseDialogs';

/** «عرض / تعديل»: the explicit, labelled way into a case from any list. */
export function ViewCaseButton({ id, caseNo }: { id: number; caseNo: number }) {
  const { t } = useTranslation();
  return (
    <Button asChild variant="secondary" size="sm">
      <Link to={`/cases/${id}`} aria-label={t('cases.viewCase', { no: caseNo })}>
        <Pencil aria-hidden="true" />
        {t('cases.view')}
      </Link>
    </Button>
  );
}

/**
 * A whole row opens the case on click (mouse convenience); keyboard and screen-reader users use
 * the case-number link and the row buttons. Clicks on controls inside the row, and on menus or
 * dialogs rendered in a portal (React bubbles those through the row), are left alone.
 */
export function useRowOpen() {
  const navigate = useNavigate();
  return (id: number) => (e: MouseEvent<HTMLElement>) => {
    const target = e.target as Element;
    if (!e.currentTarget.contains(target)) return;
    if (target.closest('a, button, input, select, textarea, label, [role="menuitem"]')) return;
    if (window.getSelection()?.toString()) return;
    void navigate(`/cases/${id}`);
  };
}

/** Row classes for a clickable row: pointer, hover, and a focus ring when a control inside has focus. */
export const clickableRow =
  'cursor-pointer hover:bg-hover has-[:focus-visible]:bg-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-focus';

export type CaseAction = { kind: 'status' | 'cancel'; id: number } | null;

const itemClass =
  'flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] font-semibold outline-none data-[highlighted]:bg-hover data-[disabled]:cursor-default data-[disabled]:text-muted [&_svg]:size-[18px] [&_svg]:text-muted';

/**
 * Row «⋮» menu. What it offers comes from the API: the case is read when the menu opens and only
 * the actions in allowedStatuses / canCancel are listed (no lifecycle rule on the client).
 */
export function CaseRowMenu({
  id,
  caseNo,
  onAction,
}: {
  id: number;
  caseNo: number;
  onAction: (a: CaseAction) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: detail } = useQuery({ ...caseQuery(id), enabled: open });
  const canChange = detail ? detail.allowedStatuses.some((s) => s !== 'cancelled') : false;
  return (
    // Not modal: a dialog opened from an item must get the focus and the pointer at once.
    <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('cases.more', { no: caseNo })} className="px-1.5">
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-52 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-dialog)]"
        >
          <DropdownMenu.Item className={itemClass} onSelect={() => void navigate(`/cases/${id}`)}>
            <ExternalLink aria-hidden="true" />
            {t('cases.menuOpen')}
          </DropdownMenu.Item>
          {!detail ? (
            <DropdownMenu.Item className={itemClass} disabled>
              <Spinner label={t('common.loading')} />
            </DropdownMenu.Item>
          ) : (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              {canChange && (
                <DropdownMenu.Item className={itemClass} onSelect={() => onAction({ kind: 'status', id })}>
                  <Repeat aria-hidden="true" />
                  {t('caseDetails.changeStatus')}
                </DropdownMenu.Item>
              )}
              {detail.canCancel && (
                <DropdownMenu.Item
                  className={`${itemClass} text-danger [&_svg]:text-danger`}
                  onSelect={() => onAction({ kind: 'cancel', id })}
                >
                  <Ban aria-hidden="true" />
                  {t('caseDetails.cancelCase')}
                </DropdownMenu.Item>
              )}
              {!canChange && !detail.canCancel && (
                <DropdownMenu.Item className={itemClass} disabled>
                  {t('cases.menuNone')}
                </DropdownMenu.Item>
              )}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The same status and cancel dialogs as the details page, for a case chosen from a list. */
export function CaseActionDialogs({ action, onClose }: { action: CaseAction; onClose: () => void }) {
  const { data: detail } = useQuery({ ...caseQuery(action?.id ?? 0), enabled: action !== null });
  const { data: settings } = useQuery(settingsQuery);
  if (!action || !detail) return null;
  const close = (o: boolean) => !o && onClose();
  return action.kind === 'status' ? (
    <StatusDialog
      detail={detail}
      today={todayIn(settings?.labProfile?.timeZone ?? 'UTC')}
      open
      onOpenChange={close}
    />
  ) : (
    <CancelCaseDialog detail={detail} open onOpenChange={close} />
  );
}
