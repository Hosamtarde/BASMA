import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  apiPost,
  apiPostKey,
  apiToken,
  expectAccessible,
  expectDirection,
  setLanguage,
  shot,
  signedIn,
  switchLanguage,
  uid,
} from './support';

/**
 * B5b items 14 and 18: every route at 390 px (a phone), in both languages. The page itself never
 * scrolls sideways (WCAG 1.4.10 reflow; a wide table scrolls inside its own card), and axe finds
 * nothing. Independent of other files: it seeds its own uniquely named data through the real API.
 */
const PHONE = { width: 390, height: 844 };
const TODAY = new Date().toISOString().slice(0, 10);
const SOON = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

interface Seeded {
  caseId: number;
  invoiceId: number;
  doctorId: number;
  doctorName: string;
  suffix: string;
}

async function seed(request: APIRequestContext): Promise<Seeded> {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number }>(request, token, '/work-types', {
    name: `تاج ${suffix}`,
    unitPrice: 40000,
  });
  const doctor = await apiPost<{ id: number; name: string }>(request, token, '/doctors', {
    name: `د. سامي ${suffix}`,
  });
  const created = await apiPost<{ id: number }>(request, token, '/cases', {
    doctorId: doctor.id,
    patientName: `مريض ${suffix}`,
    receivedDate: TODAY,
    expectedDate: '2099-12-31',
    lines: [{ toothNo: 11, workTypeId: workType.id, unitPrice: 40000 }],
  });
  await apiPostKey(request, token, '/payments', {
    doctorId: doctor.id,
    method: 'cheque',
    amount: 10000,
    cheque: { chequeNo: `CH-${suffix}`, bank: 'بنك فلسطين', dueDate: SOON },
  });
  const category = await apiPost<{ id: number }>(request, token, '/expense-categories', {
    name: `إيجار ${suffix}`,
  });
  await apiPostKey(request, token, '/outgoing-payments', {
    categoryId: category.id,
    payee: `مؤجّر ${suffix}`,
    method: 'cheque',
    amount: 100000,
    cheque: { chequeNo: `OUT-${suffix}`, bank: 'بنك فلسطين', dueDate: SOON },
  });
  // B6: one issued invoice for the invoice view.
  const invoice = await apiPostKey<{ id: number }>(request, token, '/invoices', {
    type: 'free',
    doctorId: doctor.id,
    reason: `أجرة ${suffix}`,
    amount: 2500,
  });
  return { caseId: created.id, invoiceId: invoice.id, doctorId: doctor.id, doctorName: doctor.name, suffix };
}

/** The document is not wider than the screen (a table may scroll inside its own card). */
async function expectNoSidewaysScroll(page: Page) {
  const wide = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(wide.scroll, 'the page must not scroll sideways').toBeLessThanOrEqual(wide.client);
}

function routes(s: Seeded): { name: string; path: string; table?: boolean }[] {
  return [
    { name: 'home', path: '/' },
    { name: 'cases', path: `/cases?q=${encodeURIComponent(s.suffix)}`, table: true },
    { name: 'case-new', path: '/cases/new' },
    { name: 'case-details', path: `/cases/${s.caseId}` },
    { name: 'payments', path: `/payments?q=${encodeURIComponent(s.suffix)}`, table: true },
    { name: 'outgoing', path: '/outgoing', table: true },
    { name: 'cheques', path: `/cheques?q=${encodeURIComponent(s.suffix)}`, table: true },
    { name: 'debts', path: '/debts', table: true },
    { name: 'doctors', path: `/doctors?q=${encodeURIComponent(s.suffix)}`, table: true },
    { name: 'doctor-info', path: `/doctors/${s.doctorId}` },
    { name: 'doctor-prices', path: `/doctors/${s.doctorId}/prices` },
    { name: 'doctor-payments', path: `/doctors/${s.doctorId}/payments` },
    { name: 'doctor-statement', path: `/doctors/${s.doctorId}/statement` },
    { name: 'invoices', path: `/invoices?q=${encodeURIComponent(s.suffix)}`, table: true },
    { name: 'invoice-new', path: `/invoices/new?doctor=${s.doctorId}` },
    { name: 'invoice-new-free', path: '/invoices/new?type=free' },
    { name: 'invoice-view', path: `/invoices/${s.invoiceId}` },
    { name: 'invoice-appearance', path: '/invoice-appearance' },
    { name: 'settings', path: '/settings' },
    { name: 'settings-work-types', path: '/settings/work-types' },
    { name: 'settings-technicians', path: '/settings/technicians' },
    { name: 'settings-expense-categories', path: '/settings/expense-categories' },
    { name: 'change-password', path: '/change-password' },
  ];
}

for (const lang of ['ar', 'en'] as const) {
  test(`every route fits a 390 px screen and is axe clean (${lang})`, async ({ page, request }) => {
    test.setTimeout(240_000);
    const s = await seed(request);
    await page.setViewportSize(PHONE);
    await signedIn(page);
    await setLanguage(page, lang);
    try {
      for (const route of routes(s)) {
        await test.step(route.name, async () => {
          await page.goto(route.path);
          await expectDirection(page, lang);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          // Lists: wait for the real rows, not the loading state.
          if (route.table) await expect(page.getByRole('table').first()).toBeVisible();
          await expectNoSidewaysScroll(page);
          await expectAccessible(page);
          await shot(page, `${route.name}-390-${lang}`, { fullPage: true });
        });
      }

      // The bell panel (B5) on the same phone: inside the screen, axe clean, Esc returns to the bell.
      await test.step('notifications bell', async () => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const bell = page.getByRole('button', {
          name: new RegExp(`^${lang === 'ar' ? 'الإشعارات' : 'Notifications'}`),
        });
        await bell.click();
        const panel = page.getByRole('dialog', { name: lang === 'ar' ? 'الإشعارات' : 'Notifications' });
        await expect(panel).toBeVisible();
        const box = await panel.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
        await expectNoSidewaysScroll(page);
        await expectAccessible(page);
        await page.keyboard.press('Escape');
        await expect(bell).toBeFocused();
      });

      // Desktop views of the same lists for the slice report: the page itself never scrolls sideways (a wide
      // table, e.g. with long names, scrolls inside its card).
      await page.setViewportSize({ width: 1366, height: 768 });
      for (const route of routes(s).filter((r) => r.table || r.name === 'case-details')) {
        await test.step(`desktop ${route.name}`, async () => {
          await page.goto(route.path);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          if (route.table) {
            const region = page
              .getByRole('group')
              .filter({ has: page.getByRole('table') })
              .first();
            await expect(region).toBeVisible();
          }
          await expectNoSidewaysScroll(page);
          await shot(page, `${route.name}-1366-${lang}`, { fullPage: false });
        });
      }
    } finally {
      // The language belongs to the installation: leave it as other files expect it (Arabic).
      if (lang === 'en') {
        await page.goto('/');
        await switchLanguage(page, /^العربية/);
      }
    }
  });
}
