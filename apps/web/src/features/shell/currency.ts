import { formatMoney } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { localeOf } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { settingsQuery } from './settings';

/** The installation currency (set at first run). Amounts are integer minor units everywhere. */
export function useCurrency() {
  const { data } = useQuery(settingsQuery);
  const decimals = data?.currency?.decimals ?? 2;
  const symbol = data?.currency?.symbol ?? '';
  return {
    decimals,
    symbol,
    format: (minor: number) => formatMoney(minor, decimals, localeOf(currentLanguage())),
  };
}
