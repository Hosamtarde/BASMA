import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { apiPost, apiPostKey, apiToken, expectAccessible, setLanguage, shot, signedIn, switchLanguage, uid } from './support';

/**
 * B6 (SPEC §5.14, §5.15; docs/plans/b6-invoices.md §8): issuing the three kinds of document from the screens,
 * the A4 print view, void, the printable statement from the doctor page, the appearance with its live preview,
 * injection attempts that must never execute, and the product identity that must never be printed. Every test
 * seeds its own uniquely named data through the real API and restores the shared appearance it changes.
 */
const REPORT_SIZE = { width: 1440, height: 900 };

interface Seed {
  token: string;
  suffix: string;
  doctor: { id: number; name: string };
  workType: { id: number };
}
interface Case {
  id: number;
  caseNo: number;
  rowVersion: number;
}

async function seed(request: APIRequestContext): Promise<Seed> {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number }>(request, token, '/work-types', { name: `زيركون ${suffix}`, unitPrice: 25000 });
  const doctor = await apiPost<{ id: number; name: string }>(request, token, '/doctors', { name: `د. فواتير ${suffix}`, clinic: 'عيادة الاختبار' });
  return { token, suffix, doctor, workType };
}

const newCase = (request: APIRequestContext, s: Seed, patientName = `مريض ${s.suffix}`, lines?: object[]) =>
  apiPost<Case>(request, s.token, '/cases', {
    doctorId: s.doctor.id,
    patientName,
    expectedDate: '2099-12-31',
    status: 'ready',
    lines: lines ?? [
      { toothNo: 11, workTypeId: s.workType.id, shade: 'A2' },
      { toothNo: 21, workTypeId: s.workType.id, shade: 'A2' },
    ],
  });

/** window.print is replaced so a test can count print requests without a dialog. */
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: number; print: () => void };
    w.__printed = 0;
    w.print = () => {
      w.__printed += 1;
    };
  });
}
const printed = (page: Page) => page.evaluate(() => (window as unknown as { __printed: number }).__printed);

const documentOf = (page: Page) => page.locator('[data-invoice-document]');

/** No image but the lab's own logo, no product name, no "Powered by" (SPEC §2.3). */
async function expectOnlyLabIdentity(page: Page) {
  await expect(documentOf(page).locator('img:not([data-lab-logo])')).toHaveCount(0);
  const text = (await documentOf(page).textContent()) ?? '';
  expect(text).not.toMatch(/Basma|بسمة|Smile Artec|Powered by/i);
}

test.describe('B6 invoices', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(REPORT_SIZE);
    await stubPrint(page);
  });

  test('cases invoice (ar): choose cases, see the server preview, issue and print; the case is locked; void unlocks it', async ({
    page,
    request,
  }) => {
    const s = await seed(request);
    const a = await newCase(request, s);
    const b = await newCase(request, s, `مريضة ${s.suffix}`);
    await signedIn(page);
    await setLanguage(page, 'ar');
    await page.goto(`/invoices/new?doctor=${s.doctor.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'إنشاء فاتورة' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /فاتورة حالات/ })).toBeChecked();
    await page.getByRole('checkbox', { name: 'تحديد كل الحالات' }).check();
    const preview = page.getByRole('region', { name: 'المعاينة' });
    await expect(preview.locator('[data-invoice-document="cases"]')).toBeVisible();
    await expect(preview.locator('[data-invoice-total]')).toHaveText('1,000.00 ₪');
    await expect(preview.locator('[data-invoice-no]')).toHaveText('يُعطى عند الإنشاء');
    await expectAccessible(page);
    await shot(page, 'invoice-new-ar');

    await page.getByRole('button', { name: 'إنشاء وطباعة' }).click();
    await expect(page).toHaveURL(/\/invoices\/\d+$/);
    await expect.poll(() => printed(page)).toBe(1);
    const heading = page.getByRole('heading', { level: 1, name: /^فاتورة حالات رقم \d+$/ });
    await expect(heading).toBeVisible();
    const no = Number(((await heading.textContent()) ?? '').match(/\d+$/)?.[0]);
    await expect(documentOf(page).locator('[data-invoice-no]')).toHaveText(String(no));
    await expect(documentOf(page).locator('[data-invoice-total]')).toHaveText('1,000.00 ₪');
    await expect(documentOf(page)).toHaveAttribute('dir', 'rtl');
    await expectOnlyLabIdentity(page);
    await expectAccessible(page);
    await shot(page, 'invoice-view-ar');

    // Print preview: only the document is printed; the A4 page rule and the repeating table head apply.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('complementary')).toBeHidden();
    await expect(page.getByRole('button', { name: 'طباعة' })).toBeHidden();
    await expect(documentOf(page)).toBeVisible();
    expect(await documentOf(page).locator('thead').first().evaluate((el) => getComputedStyle(el).display)).toBe('table-header-group');
    await shot(page, 'invoice-print-ar');
    await page.emulateMedia({ media: 'screen' });
    await page.getByRole('button', { name: 'حفظ PDF' }).click();
    await expect.poll(() => printed(page)).toBe(2);

    // The case is locked while the invoice is active (S13), with the reason.
    await page.goto(`/cases/${a.id}`);
    await expect(page.locator('[data-case-invoice]')).toContainText(`الفاتورة رقم ${no}`);
    const edit = page.getByRole('button', { name: 'تعديل البيانات' });
    await expect(edit).toHaveAttribute('aria-disabled', 'true');
    await expect(edit).toHaveAccessibleDescription(`الحالة على الفاتورة رقم ${no} — ألغِ الفاتورة أولًا لتعديلها أو إلغائها.`);
    await expect(page.getByRole('button', { name: 'إلغاء الحالة' })).toHaveAttribute('aria-disabled', 'true');
    await page.goto(`/cases?q=${encodeURIComponent(s.suffix)}`);
    await expect(page.locator(`[data-chip="invoiced"]`)).toHaveCount(2);

    // Void with a reason: the band shows, the cases are free again, the number stays.
    await page.goto(`/invoices?q=${no}`);
    await page.getByRole('link', { name: String(no), exact: true }).click();
    await page.getByRole('button', { name: 'إلغاء الفاتورة' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'إلغاء الفاتورة' }).click();
    await expect(dialog.getByRole('textbox', { name: /^سبب الإلغاء/ })).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    await dialog.getByRole('textbox', { name: /^سبب الإلغاء/ }).fill('اختيار حالات خاطئ');
    await dialog.getByRole('button', { name: 'إلغاء الفاتورة' }).click();
    await expect(documentOf(page).locator('[data-void-band]')).toContainText('اختيار حالات خاطئ');
    await expect(page.getByRole('button', { name: 'إلغاء الفاتورة' })).toHaveAttribute('aria-disabled', 'true');
    await shot(page, 'invoice-void-ar');
    await page.goto(`/cases/${b.id}`);
    await expect(page.getByRole('button', { name: 'تعديل البيانات' })).not.toHaveAttribute('aria-disabled', 'true');
    await page.goto(`/invoices?q=${no}`);
    await expect(page.locator(`[data-invoice="${no}"]`)).toContainText('ملغاة');
    await expectAccessible(page);
    await shot(page, 'invoices-list-ar');
  });

  test('statement from the doctor page and a free invoice (en): issued, printed, LTR UI', async ({ page, request }) => {
    const s = await seed(request);
    await newCase(request, s);
    await apiPostKey(request, s.token, '/payments', { doctorId: s.doctor.id, method: 'cash', amount: 20000 });
    await signedIn(page);
    await switchLanguage(page, /^English/);
    try {
      await page.goto(`/doctors/${s.doctor.id}/statement`);
      await page.getByRole('link', { name: 'Printable statement' }).click();
      await expect(page).toHaveURL(new RegExp(`/invoices/new\\?type=statement&doctor=${s.doctor.id}$`));
      await expect(page.getByRole('radio', { name: /Account statement/ })).toBeChecked();
      await page.getByRole('combobox', { name: /^Document language/ }).selectOption('en');
      const preview = page.getByRole('region', { name: 'Preview' });
      await expect(preview.locator('[data-invoice-document="statement"]')).toHaveAttribute('dir', 'ltr');
      await expect(preview.locator('[data-invoice-total]')).toHaveText('300.00 ₪');
      await expectAccessible(page);
      await page.getByRole('button', { name: 'Issue and print the statement' }).click();
      await expect(page.getByRole('heading', { level: 1, name: /^Account statement no\. \d+$/ })).toBeVisible();
      await expect.poll(() => printed(page)).toBe(1);
      await expect(documentOf(page).locator('[data-invoice-total]')).toHaveText('300.00 ₪');
      await expectOnlyLabIdentity(page);
      await expectAccessible(page);
      await shot(page, 'statement-view-en');
      // The same document reprinted in Arabic: labels and direction change, the figures do not.
      await page.getByRole('combobox', { name: 'Print language' }).selectOption('ar');
      await expect(documentOf(page)).toHaveAttribute('dir', 'rtl');
      await expect(documentOf(page).locator('[data-invoice-total]')).toHaveText('300.00 ₪');

      await page.goto('/invoices/new?type=free');
      await page.getByRole('radio', { name: 'Another name' }).check();
      await page.getByRole('textbox', { name: /^Party name/ }).fill(`Walk-in ${s.suffix}`);
      await page.getByRole('textbox', { name: /^Reason/ }).fill('Night guard repair');
      await page.getByRole('textbox', { name: /^Amount/ }).fill('75');
      await page.getByRole('combobox', { name: /^Document language/ }).selectOption('en');
      await expect(page.getByRole('region', { name: 'Preview' }).locator('[data-invoice-total]')).toHaveText('75.00 ₪');
      await expectAccessible(page);
      await shot(page, 'invoice-new-free-en');
      await page.getByRole('button', { name: 'Issue and print' }).click();
      await expect(page.getByRole('heading', { level: 1, name: /^Free invoice no\. \d+$/ })).toBeVisible();
      await expect(documentOf(page)).toContainText(`Walk-in ${s.suffix}`);
      await shot(page, 'invoice-view-free-en');
      await page.goto('/invoices');
      await expectAccessible(page);
      await shot(page, 'invoices-list-en');
    } finally {
      await switchLanguage(page, /^العربية/);
    }
  });

  test('appearance: live preview, saved colours apply to old invoices, columns stay frozen; injection never executes', async ({
    page,
    request,
  }) => {
    const s = await seed(request);
    const evilPatient = `<script>window.__pwned=1</script>${s.suffix}`;
    const c = await newCase(request, s, evilPatient);
    const before = await apiPostKey<{ id: number; no: number }>(request, s.token, '/invoices', {
      type: 'cases',
      doctorId: s.doctor.id,
      caseIds: [c.id],
      expectedTotal: 50000,
    });
    const auth = { Authorization: `Bearer ${s.token}` };
    const original = (await (await request.get('/api/v1/settings/invoice-template', { headers: auth })).json()) as {
      template: Record<string, unknown>;
      rowVersion: number;
    };
    await signedIn(page);
    await setLanguage(page, 'ar');
    try {
      await page.goto('/invoice-appearance');
      await expect(page.getByRole('heading', { level: 1, name: 'مظهر الفاتورة' })).toBeVisible();
      const colour = page.getByRole('textbox', { name: /^اللون الرئيسي/ });
      await colour.fill('url(javascript:alert(1))');
      await expect(colour).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('button', { name: 'حفظ' })).toBeDisabled();
      await colour.fill('#B4232A');
      await page.getByRole('textbox', { name: /^لون رأس الجدول/ }).fill('#5A2D82');
      await page.getByRole('checkbox', { name: 'اللون', exact: true }).uncheck();
      const evilFooter = '<img src=x onerror="window.__pwned=1"> javascript:alert(1)';
      await page.getByRole('textbox', { name: /^نص التذييل/ }).fill(evilFooter);
      const preview = page.getByRole('region', { name: 'معاينة ببيانات تجريبية' });
      await expect(preview.locator('[data-invoice-notes]')).toContainText(evilFooter);
      await expect(preview.locator('th[data-col="shade"]')).toHaveCount(0);
      await expectAccessible(page);
      await shot(page, 'invoice-appearance-ar');
      await page.getByRole('button', { name: 'حفظ' }).click();
      await expect(page.getByText('تم حفظ إعدادات أعمدة الفاتورة.').first()).toBeVisible();

      // The invoice issued before keeps its columns (frozen) but takes the new colours.
      await page.goto(`/invoices/${before.id}`);
      await expect(documentOf(page).locator('th[data-col="shade"]')).toHaveCount(1);
      await expect(documentOf(page)).toHaveCSS('--inv-primary', '#B4232A');
      // A new invoice freezes the new layout, the footer included, as text.
      await page.goto(`/invoices/new?doctor=${s.doctor.id}`);
      await expect(page.getByText('لا توجد حالات بانتظار الفوترة.')).toBeVisible();
      const second = await newCase(request, s, `مريض آخر ${s.suffix}`);
      await page.reload();
      await page.getByRole('checkbox', { name: `تحديد الحالة رقم ${second.caseNo}` }).check();
      await page.getByRole('button', { name: 'إنشاء وطباعة' }).click();
      await expect(page).toHaveURL(/\/invoices\/\d+$/);
      await expect(documentOf(page).locator('th[data-col="shade"]')).toHaveCount(0);
      await expect(documentOf(page).locator('[data-invoice-notes]')).toContainText(evilFooter);

      // Nothing executed, nothing was injected, in the preview or the print view.
      for (const media of ['screen', 'print'] as const) {
        await page.emulateMedia({ media });
        await expect(documentOf(page).locator('script, img[src="x"], a[href^="javascript"]')).toHaveCount(0);
      }
      await page.emulateMedia({ media: 'screen' });
      await page.goto(`/invoices/${before.id}`);
      await expect(documentOf(page)).toContainText(evilPatient);
      await expect(documentOf(page).locator('script')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
      await expectOnlyLabIdentity(page);
    } finally {
      // Shared installation state: put the appearance back as it was.
      const now = (await (await request.get('/api/v1/settings/invoice-template', { headers: auth })).json()) as { rowVersion: number };
      const res = await request.put('/api/v1/settings/invoice-template', {
        headers: auth,
        data: { rowVersion: now.rowVersion, template: original.template },
      });
      expect(res.status()).toBe(200);
    }
  });

  test('a long invoice prints on several A4 pages with the table head on each', async ({ page, request }) => {
    const s = await seed(request);
    // 60 lines with different shades → 60 printed rows.
    const lines = Array.from({ length: 60 }, (_, i) => ({ toothNo: 11 + (i % 8), workTypeId: s.workType.id, shade: `S${i + 1}` }));
    const c = await newCase(request, s, `مريض طويل ${s.suffix}`, lines);
    const inv = await apiPostKey<{ id: number }>(request, s.token, '/invoices', {
      type: 'cases',
      doctorId: s.doctor.id,
      caseIds: [c.id],
      expectedTotal: 60 * 25000,
    });
    await signedIn(page);
    await setLanguage(page, 'ar');
    await page.goto(`/invoices/${inv.id}`);
    await expect(documentOf(page).locator('tbody tr')).toHaveCount(60);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(2);
    await page.emulateMedia({ media: 'screen' });
  });
});
