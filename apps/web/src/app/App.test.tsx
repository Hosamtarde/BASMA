import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { changeLanguage, initI18n } from '@/i18n/i18n';
import { App } from './App';

/** The toast region is a named landmark: its name follows the language, both ways (B6b cleanup). */
describe('App — the notifications region', () => {
  beforeEach(async () => {
    await initI18n('ar');
  });

  const region = () => document.querySelector('section[aria-live="polite"]') as HTMLElement;

  it('is named in Arabic, then in English after switching, then in Arabic again', async () => {
    const router = createMemoryRouter([{ path: '/', element: <p>home</p> }]);
    render(<App queryClient={createQueryClient()} router={router} />);
    await screen.findByText('home');
    expect(region()).toHaveAccessibleName(/^الإشعارات/);
    await act(async () => {
      await changeLanguage('en');
    });
    await waitFor(() => expect(region()).toHaveAccessibleName(/^Notifications/));
    expect(region().getAttribute('aria-label')).not.toMatch(/الإشعارات/);
    await act(async () => {
      await changeLanguage('ar');
    });
    await waitFor(() => expect(region()).toHaveAccessibleName(/^الإشعارات/));
  });
});
