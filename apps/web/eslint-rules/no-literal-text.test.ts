import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import plugin from './no-literal-text.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const error = { messageId: 'literal' };

tester.run('no-literal-text', plugin.rules['no-literal-text'], {
  valid: [
    { code: '<p>{t("home.title")}</p>' },
    { code: '<p>{PRODUCT_NAME}</p>' },
    { code: '<span> · </span>' },
    { code: '<span>{count} / 25</span>' },
    { code: '<button aria-label={t("common.close")} />' },
    { code: '<div className="flex gap-2" data-testid="shell" />' },
    { code: '<input type="password" autoComplete="current-password" />' },
    { code: '<p>{`${a} — ${b}`}</p>' },
  ],
  invalid: [
    { code: '<p>تسجيل الدخول</p>', errors: [error] },
    { code: '<p>Sign in</p>', errors: [error] },
    { code: '<p>{"Sign in"}</p>', errors: [error] },
    { code: '<p>{ok ? "Saved" : t("x")}</p>', errors: [error] },
    { code: '<p>{`Hello ${name}`}</p>', errors: [error] },
    { code: '<button aria-label="إغلاق" />', errors: [error] },
    { code: '<img alt="logo" src={src} />', errors: [error] },
    { code: '<input placeholder={"Search..."} />', errors: [error] },
    { code: '<abbr title="kilo">k</abbr>', errors: [error, error] },
  ],
});
