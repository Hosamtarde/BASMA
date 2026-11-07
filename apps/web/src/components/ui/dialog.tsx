import { X } from 'lucide-react';
import { AlertDialog, Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from './button';

const overlay = 'fixed inset-0 z-50 bg-ink/40';
// Centred without physical properties (RTL guard): inset-0 + m-auto + h-fit.
const panel =
  'fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-[var(--radius-card)] bg-card shadow-[var(--shadow-dialog)]';

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Wider dialog (e.g. the work-types manager inside the case form, F2). */
  wide?: boolean;
}

/** Modal with a title, Esc/overlay to close and focus kept inside (Radix). */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: FormDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content
          className={cn(panel, wide ? 'w-[min(960px,calc(100vw-32px))]' : 'w-[min(560px,calc(100vw-32px))]')}
        >
          <div className="flex items-start gap-3 border-b border-border px-6 pt-5 pb-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[19px] font-extrabold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[14px] text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t('common.close')}>
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  danger?: boolean;
}

/** Destructive actions always confirm (SPEC §6). Cancel is the default focus. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  busy,
  danger = true,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={cn(panel, 'w-[min(460px,calc(100vw-32px))] p-6')}>
          <AlertDialog.Title className="text-[19px] font-extrabold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-muted">{body}</AlertDialog.Description>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <AlertDialog.Action asChild>
              <Button
                variant={danger ? 'danger' : 'primary'}
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  onConfirm();
                }}
              >
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
