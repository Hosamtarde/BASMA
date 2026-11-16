import { useQuery } from '@tanstack/react-query';
import { meQuery } from './api';

/**
 * What the signed-in user may do, from the API's `/auth/me`. Used only to hide controls that would
 * be refused; the server checks every request (SPEC §3.3). Unknown (not loaded yet) means "no".
 */
export function useCan(): (permission: string) => boolean {
  // Never throws: a failed lookup only hides controls (the server still checks every request).
  const { data } = useQuery({ ...meQuery, throwOnError: false });
  const granted = new Set(data?.permissions ?? []);
  return (permission) => granted.has(permission);
}
