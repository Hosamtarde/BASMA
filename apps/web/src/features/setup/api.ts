import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';

export const setupKeys = {
  status: ['setup', 'status'] as const,
};

/** Boot decision: first-run wizard or login. */
export const setupStatusQuery = queryOptions({
  queryKey: setupKeys.status,
  queryFn: () => unwrap(api.GET('/api/v1/setup/status')),
  staleTime: Infinity,
});
