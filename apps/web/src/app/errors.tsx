import { Copy, RefreshCw, SearchX, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { ApiError, NetworkError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { ApiDownPage } from './status';

interface ErrorPageProps {
  icon: ReactNode;
  title: string;
  body: string;
  correlationId?: string | undefined;
  reload?: boolean;
}

export function ErrorPage({ icon, title, body, correlationId, reload = false }: ErrorPageProps) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto mt-10 max-w-lg rounded-[var(--radius-card)] border border-border bg-card p-8 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-surface text-cyan-ink [&_svg]:size-6">
        {icon}
      </div>
      <h1 className="mt-3 text-[22px] font-extrabold">{title}</h1>
      <p className="mt-1.5 text-muted">{body}</p>
      {correlationId && (
        <p className="mt-3 flex items-center justify-center gap-2 text-[13px] text-muted">
          <span>{t('errors.reference')}</span>
          <code className="num rounded bg-surface px-1.5 py-0.5">{correlationId}</code>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('common.copy')}
            onClick={() => void navigator.clipboard?.writeText(correlationId)}
          >
            <Copy aria-hidden="true" />
          </Button>
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        {reload && (
          <Button onClick={() => window.location.reload()}>
            <RefreshCw aria-hidden="true" />
            {t('common.reload')}
          </Button>
        )}
        <Button variant="secondary" asChild>
          <Link to="/">{t('common.backHome')}</Link>
        </Button>
      </div>
    </section>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <ErrorPage
      icon={<SearchX aria-hidden="true" />}
      title={t('errors.notFound.title')}
      body={t('errors.notFound.body')}
    />
  );
}

/** Error boundary of every route: a dedicated page per kind, never a blank screen or a stack. */
export function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();
  if (error instanceof NetworkError) return <ApiDownPage onRetry={() => window.location.reload()} />;
  if (error instanceof ApiError && error.kind === 'forbidden') {
    return (
      <ErrorPage
        icon={<ShieldAlert aria-hidden="true" />}
        title={t('errors.forbidden.title')}
        body={t('errors.forbidden.body')}
      />
    );
  }
  if (
    (error instanceof ApiError && error.kind === 'notFound') ||
    (isRouteErrorResponse(error) && error.status === 404)
  ) {
    return <NotFoundPage />;
  }
  return (
    <ErrorPage
      icon={<TriangleAlert aria-hidden="true" />}
      title={t('errors.route.title')}
      body={t('errors.route.body')}
      correlationId={error instanceof ApiError ? error.correlationId : undefined}
      reload
    />
  );
}
