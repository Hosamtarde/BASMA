import { queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { components } from '@/api/schema.gen';
import { session } from '@/api/session';

export type Me = components['schemas']['MeResponse'];
export type TokenResponse = components['schemas']['TokenResponse'];

export const authKeys = {
  me: ['auth', 'me'] as const,
};

export const meQuery = queryOptions({
  queryKey: authKeys.me,
  queryFn: () => unwrap(api.GET('/api/v1/auth/me')),
});

/** Signs in: the access token goes to memory, the refresh token arrives as an httpOnly cookie. */
export async function signIn(username: string, password: string): Promise<TokenResponse> {
  const tokens = await unwrap(api.POST('/api/v1/auth/login', { body: { username, password } }));
  session.set(tokens);
  return tokens;
}

/** Ends the server session (cookie cleared there) and forgets everything cached here. */
export async function signOut(queryClient: QueryClient): Promise<void> {
  try {
    await unwrap(api.POST('/api/v1/auth/logout'));
  } catch {
    // Already expired or offline: the local sign-out below still happens.
  } finally {
    session.clear();
    queryClient.clear();
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await unwrap(api.POST('/api/v1/auth/change-password', { body: { currentPassword, newPassword } }));
}
