import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { House, Settings as SettingsIcon, Stethoscope } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { meQuery } from '@/features/auth/api';
import { changeLanguage, currentLanguage, rememberLanguage } from '@/i18n/i18n';
import { AppShell } from './AppShell';
import type { NavItem } from './AppShell';
import { LabBrand } from './LabBrand';
import { LanguageSwitch } from './LanguageSwitch';
import { labNameFor, saveLanguage, settingsQuery, takeSignedOutLanguageChoice, useLogoUrl } from './settings';
import { UserMenu } from './UserMenu';

/**
 * Signed-in layout. Sidebar items appear only when their slice ships (no dead items, SPEC §3.2):
 * F1: Home, Doctors and Settings (with the catalog lists); cases arrive with F2.
 */
export function ShellLayout() {
  const { t } = useTranslation();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const logoUrl = useLogoUrl(settings);
  const lang = currentLanguage();

  // The UI language is a per-installation setting. After sign-in, a language picked on the login
  // page during this visit wins and is saved; otherwise the saved one applies. Before paint, so
  // the screen never flickers between languages.
  const queryClient = useQueryClient();
  const applied = useRef(false);
  useLayoutEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const saved = settings.language?.ui;
    if (takeSignedOutLanguageChoice()) {
      void saveLanguage(queryClient, currentLanguage());
    } else if (saved && saved !== currentLanguage()) {
      void changeLanguage(saved);
      rememberLanguage(saved);
    }
  }, [queryClient, settings.language?.ui]);

  const nav: NavItem[] = [
    { to: '/', label: t('nav.home'), icon: <House aria-hidden="true" />, end: true },
    { to: '/doctors', label: t('nav.doctors'), icon: <Stethoscope aria-hidden="true" /> },
  ];
  const navBottom: NavItem[] = [
    { to: '/settings', label: t('nav.settings'), icon: <SettingsIcon aria-hidden="true" /> },
  ];

  return (
    <AppShell
      brand={<LabBrand name={labNameFor(settings, lang)} logoUrl={logoUrl} logoAlt={t('shell.logoAlt')} />}
      nav={nav}
      navBottom={navBottom}
      topBarEnd={
        <>
          <LanguageSwitch />
          <UserMenu username={me.username} />
        </>
      }
      labels={{
        sidebar: t('shell.sidebar'),
        mainNav: t('shell.mainNav'),
        skipToContent: t('shell.skipToContent'),
      }}
    >
      <Outlet />
    </AppShell>
  );
}
