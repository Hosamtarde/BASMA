import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { changeLanguage, initI18n } from '@/i18n/i18n';
import { envelope, json, renderRoutes, stubApi } from '@/test/render';
import { LoginPage } from './LoginPage';

const routes = [
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <p>home page</p> },
  { path: '/change-password', element: <p>forced change</p> },
];
const tokens = (mustChangePassword = false) => ({
  accessToken: 'access-1',
  accessTokenExpiresIn: 900,
  refreshTokenExpiresAt: '2026-12-07T00:00:00.000Z',
  mustChangePassword,
});

describe('LoginPage', () => {
  beforeEach(async () => {
    resetSessionForTests();
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('validates in Arabic before calling the API, with linked error messages', async () => {
    const calls = stubApi({});
    renderRoutes(routes, '/login');
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }));
    const username = screen.getByRole('textbox', { name: 'اسم المستخدم' });
    expect(username).toHaveAttribute('aria-invalid', 'true');
    expect(username).toHaveAccessibleDescription('هذا الحقل مطلوب.');
    expect(calls).toEqual([]);
  });

  it("shows the server's localized message and clears the password on wrong credentials", async () => {
    stubApi({
      'POST /api/v1/auth/login': () =>
        json(401, envelope('error.auth.invalid_credentials', 'اسم المستخدم أو كلمة المرور غير صحيحة.')),
    });
    renderRoutes(routes, '/login');
    await userEvent.type(screen.getByRole('textbox', { name: 'اسم المستخدم' }), 'owner');
    await userEvent.type(screen.getByLabelText('كلمة المرور'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('اسم المستخدم أو كلمة المرور غير صحيحة.');
    expect(screen.getByLabelText('كلمة المرور')).toHaveValue('');
    expect(session.token()).toBeNull();
  });

  it('keeps the access token in memory and goes home', async () => {
    const calls = stubApi({ 'POST /api/v1/auth/login': () => json(200, tokens()) });
    const { router } = renderRoutes(routes, '/login');
    await userEvent.type(screen.getByRole('textbox', { name: 'اسم المستخدم' }), 'owner');
    await userEvent.type(screen.getByLabelText('كلمة المرور'), 'right-password');
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(session.token()).toBe('access-1');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ username: 'owner', password: 'right-password' });
  });

  it('sends a must-change-password account to the forced change first', async () => {
    stubApi({ 'POST /api/v1/auth/login': () => json(200, tokens(true)) });
    const { router } = renderRoutes(routes, '/login');
    await userEvent.type(screen.getByRole('textbox', { name: 'اسم المستخدم' }), 'owner');
    await userEvent.type(screen.getByLabelText('كلمة المرور'), 'temp-password');
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'));
  });

  it('renders in English with the same structure', async () => {
    stubApi({});
    await changeLanguage('en');
    renderRoutes(routes, '/login');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Powered by Smile Artec Dental Laboratory')).toBeInTheDocument();
    await changeLanguage('ar');
  });
});
