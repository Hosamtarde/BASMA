import { queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { components } from '@/api/schema.gen';

export type NotificationFeed = components['schemas']['NotificationsResponse'];
export type NotificationGroup = components['schemas']['NotificationGroupResponse'];
export type NotificationItem = components['schemas']['NotificationItemResponse'];
export type NotificationType = NotificationItem['type'];

/** Polling of the bell badge while the window is visible (B5 plan §5.3). */
export const COUNT_INTERVAL_MS = 60_000;

export const notificationKeys = {
  all: ['notifications'] as const,
  count: ['notifications', 'count'] as const,
  /** Texts come from the API in the request language: one cache entry per language. */
  feed: (language: string) => ['notifications', 'feed', language] as const,
};

export const notificationCountQuery = queryOptions({
  queryKey: notificationKeys.count,
  queryFn: () => unwrap(api.GET('/api/v1/notifications/count')),
  refetchInterval: COUNT_INTERVAL_MS,
  // TanStack pauses the interval while the tab is hidden (refetchIntervalInBackground: false).
  refetchIntervalInBackground: false,
});

export const notificationFeedQuery = (language: string) =>
  queryOptions({
    queryKey: notificationKeys.feed(language),
    queryFn: () => unwrap(api.GET('/api/v1/notifications', { params: { query: { limit: 20 } } })),
  });

export const notificationApi = {
  /** Opening the bell: everything in the feed now becomes read (N6). */
  markAllSeen: () => unwrap(api.PATCH('/api/v1/notifications/state', { body: { all: true, seen: true } })),
  dismiss: (key: string) => unwrap(api.PATCH('/api/v1/notifications/state', { body: { keys: [key], dismissed: true } })),
};

/** Any case or money write can change the feed (due dates, cheques, what is still owed). */
export function refreshNotifications(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: notificationKeys.all });
}

/** Where an item leads: the case, or the register filtered on that cheque. */
export function notificationHref(item: NotificationItem): string {
  if (item.entity.kind === 'case') return `/cases/${item.entity.id}`;
  const q = new URLSearchParams({ direction: item.entity.direction ?? 'in', q: item.entity.chequeNo ?? '' });
  return `/cheques?${q.toString()}`;
}

/** «عرض الكل»: the existing list with the matching filter. */
export function groupHref(type: NotificationType): string {
  switch (type) {
    case 'case_due':
      return '/cases?overdue=1';
    case 'cheque_in_due':
      return '/cheques?direction=in&due=soon';
    case 'cheque_out_due':
      return '/cheques?direction=out&due=soon';
    case 'collect_due':
      return '/debts';
  }
}
