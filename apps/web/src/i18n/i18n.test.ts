import { PRODUCT_NAME } from '@app/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import ar from './ar.json';
import en from './en.json';
import { formatNumber, formatWeekday, todayIn } from './format';
import { changeLanguage, currentLanguage, i18next, initI18n, rememberLanguage, storedLanguage } from './i18n';

describe('i18n', () => {
  beforeEach(async () => {
    localStorage.clear();
    await initI18n('ar');
  });

  it('starts in Arabic, right to left', () => {
    expect(currentLanguage()).toBe('ar');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(i18next.t('auth.login.title')).toBe('تسجيل الدخول');
  });

  it('switches to English in place and flips the direction', async () => {
    await changeLanguage('en');
    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
    expect(i18next.t('auth.login.title')).toBe('Sign in');
  });

  it('shows the product name «بسمة» / «Basma» as the tab title, following the language', async () => {
    expect(document.title).toBe('بسمة');
    await changeLanguage('en');
    expect(document.title).toBe('Basma');
  });

  it('keeps the English product name equal to the one PRODUCT_NAME constant', () => {
    expect(en.app.productName).toBe(PRODUCT_NAME);
    expect(ar.app.productName).toBe('بسمة');
  });

  it('uses the Arabic plural forms', () => {
    expect(i18next.t('auth.password.hint', { count: 2 })).toBe('حرفان على الأقل.');
    expect(i18next.t('auth.password.hint', { count: 10 })).toBe('10 أحرف على الأقل.');
    expect(i18next.t('auth.password.hint', { count: 11 })).toBe('11 حرفًا على الأقل.');
  });

  it('remembers the login-page language in the browser only', () => {
    expect(storedLanguage()).toBe('ar');
    rememberLanguage('en');
    expect(storedLanguage()).toBe('en');
    localStorage.setItem('dentallab.language', 'fr');
    expect(storedLanguage()).toBe('ar');
  });
});

describe('formats', () => {
  it('uses Western digits in both languages', () => {
    expect(formatNumber(1234.5, 'ar')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
  });

  it('names the weekday in the UI language', () => {
    expect(formatWeekday('2026-11-07', 'ar')).toBe('السبت');
    expect(formatWeekday('2026-11-07', 'en')).toBe('Saturday');
  });

  it("computes the lab's today in its time zone", () => {
    const lateEvening = new Date('2026-11-06T22:30:00Z');
    expect(todayIn('Asia/Hebron', lateEvening)).toBe('2026-11-07');
    expect(todayIn('UTC', lateEvening)).toBe('2026-11-06');
  });
});

describe('reading order of dates and amounts inside Arabic sentences (B5b)', () => {
  beforeEach(async () => {
    await initI18n('ar');
    await changeLanguage('ar');
  });

  it('isolates a `ltr` value in Arabic so the sentence cannot reorder it', () => {
    const text = i18next.t('caseDetails.historyDelivered', { date: '2026-11-20' });
    expect(text).toBe('تاريخ التسليم: ⁦2026-11-20⁩');
    expect(i18next.t('payments.saved', { voucher: 'IN-000031', balance: '470.00 ₪' })).toContain(
      '⁦470.00 ₪⁩',
    );
  });

  it('leaves the value as it is in English', async () => {
    await changeLanguage('en');
    expect(i18next.t('caseDetails.historyDelivered', { date: '2026-11-20' })).toBe('Delivery date: 2026-11-20');
    await changeLanguage('ar');
  });

  it('every placeholder that carries a date or an amount is isolated, in both catalogs', () => {
    const risky = /\{\{\s*(date|amount|voucher|balance)\s*\}\}/;
    for (const [name, catalog] of Object.entries({ ar, en })) {
      const bad: string[] = [];
      const walk = (node: unknown, path: string) => {
        if (typeof node === 'string') {
          if (risky.test(node)) bad.push(path);
        } else if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
        }
      };
      walk(catalog, '');
      expect(bad, `${name}: placeholders without ", ltr"`).toEqual([]);
    }
  });
});
