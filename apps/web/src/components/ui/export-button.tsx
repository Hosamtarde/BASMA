import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { saveFile } from '@/api/download';
import type { Downloaded } from '@/api/download';
import { ApiError } from '@/api/errors';
import { useCan } from '@/features/auth/permissions';
import { ActionButton } from './action-button';

interface ExportButtonProps {
  /** Asks the API for the file (the generated client, `parseAs: 'blob'`). */
  run: () => Promise<Downloaded>;
  /** Extra permission needed besides `exports.run` (e.g. the breakdown carries patient names). */
  needs?: string[];
  /** Why the export is not possible now (nothing to export); the button stays visible and says so. */
  disabledReason?: string | null;
  label?: string;
  variant?: 'secondary' | 'ghost' | 'primary';
  className?: string;
}

/**
 * «تصدير CSV»: downloads the file the server builds from the filters on the screen. Hidden for a
 * user who may not export (the server refuses anyway), disabled with its reason when there is nothing
 * to export, and honest about failures: a file that is too large says to narrow the filters.
 */
export function ExportButton({ run, needs = [], disabledReason, label, variant = 'secondary', className }: ExportButtonProps) {
  const { t } = useTranslation();
  const can = useCan();
  const mutation = useMutation({
    mutationFn: run,
    onSuccess: (file) => {
      saveFile(file);
      toast.success(t('export.done', { count: file.rows }));
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : t('export.failed'));
    },
  });
  if (!can('exports.run') || !needs.every((p) => can(p))) return null;
  const reason = disabledReason ?? (mutation.isPending ? t('export.busy') : null);
  return (
    <ActionButton
      variant={variant}
      className={className}
      disabledReason={reason}
      onClick={() => mutation.mutate()}
    >
      <Download aria-hidden="true" />
      {mutation.isPending ? t('export.busy') : (label ?? t('export.csv'))}
    </ActionButton>
  );
}
