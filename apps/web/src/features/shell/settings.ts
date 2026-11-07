import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { components } from '@/api/schema.gen';
import { session } from '@/api/session';
import { reportError } from '@/app/feedback';
import { changeLanguage, rememberLanguage } from '@/i18n/i18n';
import type { Language } from '@/i18n/i18n';

export type Settings = components['schemas']['SettingsResponse'];

export const settingsKeys = {
  all: ['settings'] as const,
  logo: (sha256: string) => ['settings', 'logo', sha256] as const,
};

export const settingsQuery = queryOptions({
  queryKey: settingsKeys.all,
  queryFn: () => unwrap(api.GET('/api/v1/settings')),
});

/** The lab name in the UI language, falling back to the other language (SPEC §1). */
export function labNameFor(settings: Settings | undefined, lang: Language): string | null {
  const p = settings?.labProfile;
  if (!p) return null;
  return (lang === 'ar' ? (p.nameAr ?? p.nameEn) : (p.nameEn ?? p.nameAr)) ?? null;
}

/**
 * GET /settings/logo needs the bearer token, so it cannot be an <img src>: it is fetched as a
 * blob and shown through an object URL that is revoked when the logo changes or the view goes.
 */
export function useLogoUrl(settings: Settings | undefined): string | null {
  const sha = settings?.logo.present ? settings.logo.sha256 : null;
  const { data: blob } = useQuery({
    queryKey: settingsKeys.logo(sha ?? 'none'),
    queryFn: async () => {
      const { data, response } = await api.GET('/api/v1/settings/logo', { parseAs: 'blob' });
      return response.ok && data instanceof Blob ? data : null;
    },
    enabled: sha !== null,
    staleTime: Infinity,
    throwOnError: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // An object URL is an external resource: created and revoked together with the blob.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}

/** A language picked while signed out (login, setup) during this visit; it wins after sign-in. */
let chosenWhileSignedOut = false;

/** Reads and clears the signed-out choice (used once by the shell after sign-in). */
export function takeSignedOutLanguageChoice(): boolean {
  const chosen = chosenWhileSignedOut;
  chosenWhileSignedOut = false;
  return chosen;
}

/**
 * Saves the UI language for the installation (PATCH /settings/language). A stale version is
 * re-read and retried once; other failures are reported and the screen keeps the new language.
 */
export async function saveLanguage(queryClient: QueryClient, target: Language): Promise<void> {
  const save = async (fresh: boolean) => {
    const settings = fresh
      ? await queryClient.fetchQuery({ ...settingsQuery, staleTime: 0 })
      : await queryClient.ensureQueryData(settingsQuery);
    if (!settings.language || settings.language.ui === target) return;
    const updated = await unwrap(
      api.PATCH('/api/v1/settings/language', {
        body: { ui: target, rowVersion: settings.language.rowVersion },
      }),
    );
    queryClient.setQueryData(settingsKeys.all, updated);
  };
  try {
    await save(false);
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'stale') {
      await save(true).catch(reportError);
    } else {
      reportError(err);
    }
  }
}

/**
 * Switches the UI language in place. Signed in: saved for the installation. Signed out (login,
 * setup): remembered in this browser, and saved for the installation right after sign-in.
 */
export function useSwitchLanguage(): (target: Language) => Promise<void> {
  const queryClient = useQueryClient();
  return async (target) => {
    await changeLanguage(target);
    rememberLanguage(target);
    if (session.isAuthenticated()) await saveLanguage(queryClient, target);
    else chosenWhileSignedOut = true;
  };
}
