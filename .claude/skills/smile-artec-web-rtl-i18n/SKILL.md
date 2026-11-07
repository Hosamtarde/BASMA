---
name: smile-artec-web-rtl-i18n
description: Use whenever writing or reviewing UI text, layout, numbers or dates in the Smile Artec web app — Arabic RTL by default, English LTR switchable (SPEC §6.1).
---
# RTL and i18n rules (web)

**Text**
- All user-facing text comes from `src/i18n/ar.json` and `en.json` via `t()` (typed keys). Add both in the same commit. `npm run i18n:check` compares base keys, plural forms (Arabic: zero/one/two/few/many/other; English: one/other, optional zero) and `{{placeholders}}`.
- The ESLint rule `local/no-literal-text` rejects letters in JSX text and in `aria-label`, `title`, `alt`, `placeholder`, `label`. Symbols and digits are fine. Product name only through `PRODUCT_NAME` (`@app/shared`).
- Form messages: zod schemas carry keys via `msg('validation.minLength', { count })`; render with `renderMessage(t, …)`. Server messages arrive already localized (Accept-Language is sent on every request).
- The DB stores codes; labels for codes (statuses, methods) live in the catalogs.

**Direction**
- Logical properties only: `ms-/me-/ps-/pe-`, `start-/end-`, `text-start/end`, `border-s/e`, `rounded-s/e…`, CSS `*-inline-start/end`. `npm run rtl:check` fails on physical ones. Centre with `inset-0 m-auto`, not `left-1/2`.
- Only exception: the tooth chart keeps a fixed anatomical LTR geometry (18 on the viewer's left in both languages). Mark such lines `rtl-guard-ignore: <reason>`; labels and buttons around it still flip.
- Radix popovers/dialogs follow `Direction.Provider`; toasts sit at the top-start corner.
- An accessible name must start with the visible text (WCAG 2.5.3) and keep spaces between parts (`{' '}` between spans).

**Language switch**
- `changeLanguage()` flips `<html lang dir>`, catalogs and formatters in place (no reload).
- Signed in: saved per installation via `PATCH /settings/language` (stale `rowVersion` → re-read, retry once). Signed out: kept in `localStorage` (`dentallab.language`); a choice made on the login page during the visit wins after sign-in and is saved; otherwise the installation's saved language applies (before paint).

**Numbers, dates, names**
- Western digits in both languages: locale `ar-u-nu-latn` / `en-GB` (`src/i18n/format.ts`); Arabic-Indic digits are a later setting.
- Dates shown as stored, `YYYY-MM-DD`; weekday names in the UI language; "today" = the lab's time zone (`todayIn(settings.labProfile.timeZone)`).
- Numbers, phones, case numbers, tooth lists: `num` utility (LTR, isolated). User-entered names: `dir="auto"`. FDI numbers and shade codes are language-neutral.
- Cairo for both languages; never letter-space Arabic.
