import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { NetworkError } from '@/api/errors';
import { session } from '@/api/session';
import { meQuery } from '@/features/auth/api';
import { setupStatusQuery } from '@/features/setup/api';
import { currentLanguage } from '@/i18n/i18n';
import { ApiDownBanner, ApiDownPage, FullPageStatus, StaleDialog, useSessionToken } from './status';

/** Global pieces for every page; a session that ends on its own goes back to login with a note. */
export function Root() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  useEffect(
    () =>
      session.onExpired(() => {
        queryClient.clear();
        toast.info(t('auth.sessionExpired'));
        void navigate('/login', { replace: true, state: { from: location.pathname + location.search } });
      }),
    [navigate, queryClient, t, location.pathname, location.search],
  );
  return (
    <>
      <ApiDownBanner />
      <StaleDialog />
      <Outlet />
    </>
  );
}

/**
 * Boot: GET /setup/status decides between the first-run wizard and the app; then one silent
 * refresh restores a session from the httpOnly cookie (the access token is never stored).
 */
export function Boot() {
  const location = useLocation();
  const status = useQuery({ ...setupStatusQuery, throwOnError: false });
  const setupDone = status.data?.setupRequired === false;
  const restore = useQuery({
    queryKey: ['session', 'restore'],
    queryFn: () => session.refresh(currentLanguage()),
    enabled: setupDone && !session.isAuthenticated(),
    staleTime: Infinity,
    retry: false,
    throwOnError: false,
  });

  if (status.isPending) return <FullPageStatus />;
  if (status.isError) {
    if (status.error instanceof NetworkError) return <ApiDownPage onRetry={() => void status.refetch()} />;
    throw status.error;
  }
  const onSetup = location.pathname === '/setup';
  if (status.data.setupRequired) return onSetup ? <Outlet /> : <Navigate to="/setup" replace />;
  // Just finished setup (signed in) → home; otherwise the wizard is closed for good.
  if (onSetup) return <Navigate to={session.isAuthenticated() ? '/' : '/login'} replace />;
  if (restore.isError && restore.error instanceof NetworkError) {
    return <ApiDownPage onRetry={() => void restore.refetch()} />;
  }
  if (restore.isFetching) return <FullPageStatus />;
  return <Outlet />;
}

function MustChangePasswordGate() {
  const location = useLocation();
  const { data: me } = useSuspenseQuery(meQuery);
  if (me.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

/** Signed-in routes; a forced password change comes before anything else. */
export function RequireAuth() {
  const token = useSessionToken();
  const location = useLocation();
  if (token === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return (
    <Suspense fallback={<FullPageStatus />}>
      <MustChangePasswordGate />
    </Suspense>
  );
}
