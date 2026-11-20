import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Bell, CalendarClock, EyeOff, FileClock, Landmark } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/field';
import { useCan } from '@/features/auth/permissions';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';
import {
  groupHref,
  notificationApi,
  notificationCountQuery,
  notificationFeedQuery,
  notificationHref,
  notificationKeys,
} from './api';
import type { NotificationGroup, NotificationItem, NotificationType } from './api';

const TYPE_ICON: Record<NotificationType, ReactNode> = {
  case_due: <CalendarClock aria-hidden="true" />,
  cheque_in_due: <FileClock aria-hidden="true" />,
  cheque_out_due: <Landmark aria-hidden="true" />,
  collect_due: <Banknote aria-hidden="true" />,
};

/**
 * The bell in the top bar (SPEC §4, §5.16). The badge is polled every minute while the window is
 * visible; the button's name carries the count (no live region: polling never announces). Opening
 * the panel loads the feed and marks it read (N6); «إخفاء» hides one item until it changes.
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const can = useCan();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const enabled = can('notifications.read');
  const { data: count } = useQuery({ ...notificationCountQuery, enabled });
  const unread = count?.unread ?? 0;
  const markSeen = useMutation({
    mutationFn: notificationApi.markAllSeen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.count }),
  });

  if (!enabled) return null;
  const badge = unread > 99 ? '99+' : String(unread);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) markSeen.mutate();
      }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          className="relative px-2"
          aria-label={unread > 0 ? t('notifications.bellUnread', { count: unread }) : t('notifications.bell')}
        >
          <Bell aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              data-testid="bell-badge"
              className="num absolute -top-0.5 -end-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[11px] leading-none font-extrabold text-white ring-2 ring-card"
            >
              {badge}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          aria-label={t('notifications.title')}
          className="z-50 flex max-h-[min(560px,calc(100dvh-96px))] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-dialog)]"
        >
          {open && <Panel onNavigate={() => setOpen(false)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Panel({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
  const language = currentLanguage();
  // Always fresh when opened (the badge may have moved since the last look).
  const feed = useQuery({ ...notificationFeedQuery(language), refetchOnMount: 'always', throwOnError: false });
  // The unread dots are what was unread when the panel opened (marking read happens meanwhile).
  const [unreadAtOpen, setUnreadAtOpen] = useState<Set<string> | null>(null);
  if (feed.data && unreadAtOpen === null) {
    setUnreadAtOpen(new Set(feed.data.groups.flatMap((g) => g.items.filter((i) => !i.seen).map((i) => i.key))));
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[16px] font-extrabold">{t('notifications.title')}</h2>
        {feed.data && feed.data.total > 0 && (
          <span className="num rounded-full bg-surface px-2 text-[12.5px] font-bold text-muted">{feed.data.total}</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {feed.isPending ? (
          <div className="p-6">
            <Spinner label={t('common.loading')} />
          </div>
        ) : feed.isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 p-5">
            <p className="font-semibold text-danger">{t('notifications.loadError')}</p>
            <Button variant="secondary" size="sm" onClick={() => void feed.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : feed.data.total === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Bell aria-hidden="true" className="size-8 text-control" />
            <p className="font-bold">{t('notifications.empty')}</p>
            <p className="text-[13.5px] text-muted">{t('notifications.emptyHint')}</p>
          </div>
        ) : (
          feed.data.groups
            .filter((g) => g.total > 0)
            .map((g) => (
              <Group key={g.type} group={g} unreadAtOpen={unreadAtOpen} onNavigate={onNavigate} />
            ))
        )}
      </div>
    </>
  );
}

function Group({
  group,
  unreadAtOpen,
  onNavigate,
}: {
  group: NotificationGroup;
  unreadAtOpen: Set<string> | null;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const headingId = `notif-${group.type}`;
  const more = group.total - group.items.length;
  return (
    <section aria-labelledby={headingId} className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 bg-surface px-4 py-2 [&_svg]:size-[17px] [&_svg]:text-cyan-ink">
        {TYPE_ICON[group.type]}
        <h3 id={headingId} className="text-[13.5px] font-extrabold">
          {t(`notifications.types.${group.type}`)}{' '}
          <span className="num font-bold text-muted">({group.total})</span>
        </h3>
        <span className="flex-1" />
        <Link
          to={groupHref(group.type)}
          onClick={onNavigate}
          className="text-[13px] font-bold text-cyan-ink no-underline hover:underline"
        >
          {t('notifications.viewAll')}
        </Link>
      </div>
      <ul>
        {group.items.map((item) => (
          <Item key={item.key} item={item} fresh={unreadAtOpen?.has(item.key) ?? false} onNavigate={onNavigate} />
        ))}
      </ul>
      {more > 0 && (
        <p className="px-4 pb-2.5 text-[12.5px] text-muted">{t('notifications.more', { count: more })}</p>
      )}
    </section>
  );
}

function Item({ item, fresh, onNavigate }: { item: NotificationItem; fresh: boolean; onNavigate: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: () => notificationApi.dismiss(item.key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
  const late = item.phase === 'overdue' || item.phase === 'due';
  return (
    <li
      className={cn(
        'flex items-start gap-2 border-t border-border/70 px-4 py-2.5 first:border-t-0',
        fresh && 'bg-info-bg/60',
      )}
      hidden={dismiss.isSuccess}
      data-key={item.key}
    >
      <span
        aria-hidden="true"
        className={cn('mt-[7px] size-2 shrink-0 rounded-full', fresh ? 'bg-blue' : 'bg-transparent')}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          to={notificationHref(item)}
          onClick={onNavigate}
          className="text-[14px] leading-snug font-semibold text-ink no-underline hover:underline"
        >
          {fresh && (
            <>
              <span className="sr-only">{t('notifications.new')}</span>{' '}
            </>
          )}
          {item.text}
        </Link>
        <span
          className={cn(
            'w-fit rounded-md px-1.5 text-[12px] font-bold',
            late ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning-ink',
          )}
        >
          {t(`notifications.phase.${item.phase}`)}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 px-1.5"
        disabled={dismiss.isPending}
        aria-label={t('notifications.dismiss', { text: item.text })}
        title={t('notifications.dismissShort')}
        onClick={() => dismiss.mutate()}
      >
        <EyeOff aria-hidden="true" />
      </Button>
    </li>
  );
}
