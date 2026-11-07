import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { envelope, json, renderRoutes, stubApi } from '@/test/render';
import { SetupPage } from './SetupPage';

const routes = [
  { path: '/setup', element: <SetupPage /> },
  { path: '/', element: <p>home page</p> },
];

async function fillValid() {
  await userEvent.type(screen.getByRole('textbox', { name: 'اسم المستخدم' }), 'owner');
  await userEvent.type(screen.getByLabelText('كلمة المرور', { exact: true }), 'first-pass-1234');
  await userEvent.type(screen.getByLabelText('تأكيد كلمة المرور'), 'first-pass-1234');
  await userEvent.type(screen.getByRole('textbox', { name: 'اسم المختبر بالعربية' }), 'مختبر الاختبار');
  await userEvent.type(screen.getByRole('textbox', { name: 'الهاتف' }), '02 222 3333');
}

describe('SetupPage (first run, one step)', () => {
  beforeEach(async () => {
    resetSessionForTests();
    localStorage.clear();
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts with the owner-approved currency and the computer time zone', () => {
    stubApi({});
    renderRoutes(routes, '/setup');
    expect(screen.getByRole('textbox', { name: 'رمز العملة' })).toHaveValue('ILS');
    expect(screen.getByRole('textbox', { name: 'علامة العملة' })).toHaveValue('₪');
    expect(screen.getByRole('combobox', { name: 'عدد الخانات العشرية' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'المنطقة الزمنية' })).toHaveValue(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });

  it('needs a lab name in Arabic or English, a matching password and the policy length', async () => {
    const calls = stubApi({});
    renderRoutes(routes, '/setup');
    await userEvent.type(screen.getByLabelText('كلمة المرور', { exact: true }), 'short');
    await userEvent.type(screen.getByLabelText('تأكيد كلمة المرور'), 'other');
    await userEvent.click(screen.getByRole('button', { name: 'إنشاء الحساب والبدء' }));
    expect(await screen.findByText('اكتب اسم المختبر بالعربية أو بالإنجليزية.')).toBeInTheDocument();
    expect(screen.getByText('10 أحرف على الأقل.', { selector: 'p[id$="-error"]' })).toBeInTheDocument();
    expect(screen.getByText('كلمتا المرور غير متطابقتين.')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('sends the API shape (blank optional names as null) and signs in automatically', async () => {
    const calls = stubApi({
      'POST /api/v1/setup': () => json(201, { id: 1, username: 'owner' }),
      'POST /api/v1/auth/login': () =>
        json(200, {
          accessToken: 'a',
          accessTokenExpiresIn: 900,
          refreshTokenExpiresAt: 'x',
          mustChangePassword: false,
        }),
    });
    const { router } = renderRoutes(routes, '/setup');
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'إنشاء الحساب والبدء' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(calls.map((c) => c.key)).toEqual(['POST /api/v1/setup', 'POST /api/v1/auth/login']);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      username: 'owner',
      lab: { nameAr: 'مختبر الاختبار', nameEn: null, phone: '02 222 3333', address: null },
      currency: { code: 'ILS', symbol: '₪', decimals: 2 },
      language: 'ar',
    });
  });

  it('marks the fields the server rejected and shows its message', async () => {
    stubApi({
      'POST /api/v1/setup': () =>
        json(
          400,
          envelope('error.validation.failed', 'بعض البيانات المدخلة غير صحيحة.', {
            details: { fields: [{ field: 'lab.phone', constraints: ['matches'] }] },
          }),
        ),
    });
    renderRoutes(routes, '/setup');
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'إنشاء الحساب والبدء' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('بعض البيانات المدخلة غير صحيحة.');
    expect(screen.getByRole('textbox', { name: 'الهاتف' })).toHaveAttribute('aria-invalid', 'true');
  });
});
