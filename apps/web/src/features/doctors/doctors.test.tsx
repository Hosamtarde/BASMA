import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { envelope, json, renderRoutes, stubApi } from '@/test/render';
import { DoctorPage, DoctorPricesTab } from './DoctorPage';
import { DoctorsPage } from './DoctorsPage';

const doctor = (over: object = {}) => ({
  id: 7,
  name: 'د. أحمد سالم',
  phone: null,
  clinic: 'عيادة الأمل',
  notes: null,
  openingBalance: 0,
  active: true,
  rowVersion: 4,
  ...over,
});
const page = (items: object[]) => ({ page: 1, pageSize: 25, total: items.length, items });

describe('DoctorsPage and the doctor dialog', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists doctors with name, clinic and phone, and a link to each account', async () => {
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/doctors': () => json(200, page([doctor({ phone: '059 111 2222' })])),
    });
    renderRoutes([{ path: '/doctors', element: <DoctorsPage /> }], '/doctors');
    const row = await screen.findByRole('row', { name: /د. أحمد سالم/ });
    expect(within(row).getByRole('link', { name: 'د. أحمد سالم' })).toHaveAttribute('href', '/doctors/7');
    expect(row).toHaveTextContent('عيادة الأمل');
    expect(row).toHaveTextContent('059 111 2222');
  });

  it('sends a signed opening balance in minor units and shows a duplicate name on the name field', async () => {
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/doctors': () => json(200, page([])),
      'POST /api/v1/doctors': () =>
        json(409, envelope('error.doctor.name_taken', 'يوجد طبيب بالاسم «د. سامي» مسبقاً.')),
    });
    renderRoutes([{ path: '/doctors', element: <DoctorsPage /> }], '/doctors');
    await userEvent.click(await screen.findByRole('button', { name: 'إضافة طبيب' }));
    const dialog = await screen.findByRole('dialog', { name: 'إضافة طبيب' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'اسم الطبيب' }), 'د. سامي');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'الرصيد الافتتاحي' }), '-50.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }));

    const name = within(dialog).getByRole('textbox', { name: 'اسم الطبيب' });
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription('يوجد طبيب بالاسم «د. سامي» مسبقاً.');
    const body = JSON.parse(calls.find((c) => c.key === 'POST /api/v1/doctors')?.body ?? '{}');
    expect(body).toEqual({ name: 'د. سامي', phone: null, clinic: null, notes: null, openingBalance: -5050 });
  });

  it('edits only what changed, with the row version that was read', async () => {
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/doctors': () => json(200, page([doctor()])),
      'PATCH /api/v1/doctors/7': () => json(200, doctor({ clinic: 'عيادة النور', rowVersion: 5 })),
    });
    renderRoutes([{ path: '/doctors', element: <DoctorsPage /> }], '/doctors');
    await userEvent.click(await screen.findByRole('button', { name: 'تعديل: د. أحمد سالم' }));
    const dialog = await screen.findByRole('dialog', { name: 'تعديل بيانات الطبيب' });
    const clinic = within(dialog).getByRole('textbox', { name: 'العيادة' });
    await userEvent.clear(clinic);
    await userEvent.type(clinic, 'عيادة النور');
    await userEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/v1/doctors/7')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.key === 'PATCH /api/v1/doctors/7')?.body ?? '{}')).toEqual({
      rowVersion: 4,
      clinic: 'عيادة النور',
    });
  });
});

describe('special prices tab', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  const routes = [
    {
      path: '/doctors/:id',
      element: <DoctorPage />,
      children: [{ path: 'prices', element: <DoctorPricesTab /> }],
    },
  ];

  it('shows the general price, validates the special price and saves it in minor units', async () => {
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/doctors/7': () => json(200, doctor()),
      'GET /api/v1/doctors/7/prices': () =>
        json(200, [
          {
            workTypeId: 3,
            workTypeName: 'زيركون',
            workTypeActive: true,
            generalPrice: 25000,
            specialPrice: null,
          },
        ]),
      'PUT /api/v1/doctors/7/prices/3': () =>
        json(200, {
          workTypeId: 3,
          workTypeName: 'زيركون',
          workTypeActive: true,
          generalPrice: 25000,
          specialPrice: 22050,
        }),
    });
    renderRoutes(routes, '/doctors/7/prices');
    const row = await screen.findByRole('row', { name: /زيركون/ });
    expect(row).toHaveTextContent('250.00 ₪');
    expect(row).toHaveTextContent('السعر العام');
    const box = within(row).getByRole('textbox', { name: 'السعر الخاص لـ زيركون' });
    await userEvent.type(box, '220.505');
    await userEvent.click(within(row).getByRole('button', { name: 'حفظ' }));
    expect(box).toHaveAccessibleDescription('يُسمح بخانتين عشريتين فقط.');
    expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(false);

    await userEvent.clear(box);
    await userEvent.type(box, '220.5');
    await userEvent.click(within(row).getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PUT /api/v1/doctors/7/prices/3')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.key === 'PUT /api/v1/doctors/7/prices/3')?.body ?? '{}')).toEqual({
      price: 22050,
    });
  });
});
