import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n, storedLanguage } from '@/i18n/i18n';
import { envelope, json, renderPage, stubApi } from '@/test/render';
import { LanguageSwitch } from './LanguageSwitch';
import { takeSignedOutLanguageChoice } from './settings';

const settings = (ui: 'ar' | 'en', rowVersion: number) => ({
  logo: { present: false, mimeType: null, sizeBytes: null, sha256: null, updatedAt: null },
  labProfile: null,
  currency: null,
  language: { ui, documents: 'ar', rowVersion },
  numbering: {
    caseNo: { startValue: 1, nextValue: 1, locked: false },
    invoiceNo: { startValue: 1, nextValue: 1, locked: false },
  },
});

describe('LanguageSwitch', () => {
  beforeEach(async () => {
    resetSessionForTests();
    localStorage.clear();
    takeSignedOutLanguageChoice();
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('names the target language first (WCAG 2.5.3) and flips the page in place', async () => {
    const calls = stubApi({});
    renderPage(<LanguageSwitch />);
    const button = screen.getByRole('button', { name: /^English/ });
    expect(button).toHaveAccessibleName('English تغيير اللغة إلى الإنجليزية');
    await userEvent.click(button);
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(await screen.findByRole('button', { name: /^العربية/ })).toBeInTheDocument();
    // Signed out: kept in this browser and remembered for after sign-in; nothing sent.
    expect(storedLanguage()).toBe('en');
    expect(takeSignedOutLanguageChoice()).toBe(true);
    expect(calls).toEqual([]);
  });

  it('signed in: saves the choice for the installation with the current row version', async () => {
    session.set({ accessToken: 't' });
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settings('ar', 4)),
      'PATCH /api/v1/settings/language': () => json(200, settings('en', 5)),
    });
    renderPage(<LanguageSwitch />);
    await userEvent.click(screen.getByRole('button', { name: /^English/ }));
    await waitFor(() => expect(calls.map((c) => c.key)).toContain('PATCH /api/v1/settings/language'));
    const patch = calls.find((c) => c.key === 'PATCH /api/v1/settings/language');
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ ui: 'en', rowVersion: 4 });
  });

  it('re-reads and retries once when the saved version is stale', async () => {
    session.set({ accessToken: 't' });
    let version = 4;
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settings('ar', version)),
      'PATCH /api/v1/settings/language': async (req) => {
        const body = (await req.json()) as { rowVersion: number };
        if (body.rowVersion !== 7) {
          version = 7;
          return json(409, envelope('error.concurrency.stale', 'stale'));
        }
        return json(200, settings('en', 8));
      },
    });
    renderPage(<LanguageSwitch />);
    await userEvent.click(screen.getByRole('button', { name: /^English/ }));
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'PATCH /api/v1/settings/language')).toHaveLength(2),
    );
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });
});
