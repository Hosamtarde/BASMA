import { useTranslation } from 'react-i18next';
import { FormDialog } from '@/components/ui/dialog';
import { OutgoingForm } from './OutgoingForm';

/**
 * «استرداد رصيد» from a doctor's page (SPEC §5.9): the outgoing form with the refund category and
 * the doctor fixed. The form shows his refundable credit; the server enforces the limit.
 */
export function RefundDialog({
  open,
  onOpenChange,
  doctor,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  doctor: { id: number; name: string };
}) {
  const { t } = useTranslation();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={t('outgoing.refundTitle', { name: doctor.name })}
      description={t('outgoing.refundIntro')}
    >
      <OutgoingForm refundDoctor={doctor} onSaved={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />
    </FormDialog>
  );
}
