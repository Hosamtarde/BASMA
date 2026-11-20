import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { components } from '@/api/schema.gen';

export type ActivityItem = components['schemas']['AuditFeedItemResponse'];

/** «آخر العمليات»: the latest 20 audit entries (sanitized by the server; needs settings.read). */
export const recentActivityQuery = queryOptions({
  queryKey: ['audit', 'recent'] as const,
  queryFn: () => unwrap(api.GET('/api/v1/audit/recent')),
});
