import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/field';
import ar from '@/i18n/ar.json';
import { formatDateTimeIn } from '@/i18n/format';
import { recentActivityQuery } from './api';
import type { ActivityItem } from './api';

type ActionKey = keyof typeof ar.home.activity.action;

/** `case.created` → `case_created` (a catalog key); undefined when the screen has no text for it. */
function actionKey(action: string): ActionKey | undefined {
  const key = action.replaceAll('.', '_');
  return Object.hasOwn(ar.home.activity.action, key) ? (key as ActionKey) : undefined;
}

/** Entity types whose label is a number or code (shown LTR); the others are names (their own direction). */
const CODE_TYPES = new Set(['case', 'payment', 'outgoing_payment', 'cheque']);

function Entry({ item, timeZone }: { item: ActivityItem; timeZone: string }) {
  const { t } = useTranslation();
  const key = actionKey(item.action);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-b border-border py-2 text-[13.5px] last:border-b-0">
      <span className="min-w-0">
        <span className="font-bold">
          {key ? t(`home.activity.action.${key}`) : t('home.activity.unknown')}
        </span>
        {item.entityLabel && (
          <>
            {' '}
            {CODE_TYPES.has(item.entityType) ? (
              <span className="num font-extrabold">{item.entityLabel}</span>
            ) : (
              <span dir="auto" className="text-muted">
                {item.entityLabel}
              </span>
            )}
          </>
        )}
      </span>
      <time dateTime={item.at} className="num text-[12.5px] whitespace-nowrap text-muted">
        {formatDateTimeIn(item.at, timeZone)}
      </time>
      <span className="col-span-2 text-[12.5px] text-muted">
        {t('home.activity.by')}{' '}
        {item.actor ? <span dir="auto">{item.actor}</span> : <span>{t('home.activity.system')}</span>}
      </span>
    </li>
  );
}

/**
 * «آخر العمليات» (SPEC §5.1): the latest 20 audit entries, as the server's display-safe subset. Only
 * mounted for users who may read it (the server checks again).
 */
export function RecentActivity({ timeZone }: { timeZone: string }) {
  const { t } = useTranslation();
  // An error shows in the panel (not the page's error screen): Home works without this list.
  const feed = useQuery({ ...recentActivityQuery, throwOnError: false });
  return feed.isPending ? (
    <Spinner label={t('common.loading')} />
  ) : feed.isError ? (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-[13.5px]">
      <span className="font-semibold text-danger">{t('home.activity.loadError')}</span>
      <Button variant="secondary" size="sm" onClick={() => void feed.refetch()}>
        {t('common.retry')}
      </Button>
    </div>
  ) : feed.data.items.length === 0 ? (
    <p className="py-2 text-[13.5px] text-muted">{t('home.activity.empty')}</p>
  ) : (
    <ol className="m-0 list-none p-0">
      {feed.data.items.map((item, i) => (
        <Entry key={`${item.at}-${i}`} item={item} timeZone={timeZone} />
      ))}
    </ol>
  );
}
