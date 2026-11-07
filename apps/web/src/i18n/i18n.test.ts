import { beforeEach, describe, expect, it } from 'vitest';
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
