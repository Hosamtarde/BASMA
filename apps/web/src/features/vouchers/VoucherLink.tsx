import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * The row action «طباعة السند»: opens the A4 preview of the voucher (preview before print). A link, not a
 * button: it only navigates, and the voucher page only reads.
 */
export function VoucherLink({ to, voucherNo }: { to: string; voucherNo: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      aria-label={t('vouchers.printRowFor', { no: voucherNo })}
      title={t('vouchers.printRow')}
      data-voucher-link={voucherNo}
      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'no-underline')}
    >
      <Printer aria-hidden="true" />
    </Link>
  );
}
