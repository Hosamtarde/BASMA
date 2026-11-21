# B6b — Payment and expense vouchers, plus small cleanups (plan)

Status: **built on `feat/b6b-vouchers-and-cleanup`** (from `main` at `4044f4c`, after PR #16 / B6). Unattended run; decisions in §6.
Sources read: SPEC §5.8, §5.9, §5.14, §6.1, §7.7, §10, §12; CLAUDE.md; ENGINEERING_STANDARDS; `docs/production-readiness.md`; `docs/plans/b6-invoices.md` (§6, §12, §13), `b3-payments.md`, `b4b-outgoing-expenses.md`; skills `smile-artec-web-*`, `money-ledger`, `security-review`.

## 1. Part 1 — vouchers

**No API change.** `GET /payments/{id}` and `GET /outgoing-payments/{id}` already return everything a voucher prints (voucher number, date, doctor / payee / category, amount in minor units, method, cheque number / bank / due date / status, bound case, notes, void reason and time). The lab identity comes from the settings the invoice renderer already uses (lab profile + current logo). A voucher is not an immutable document (SPEC §5.14 covers invoices only): it is a printed view of a payment row that is itself immutable apart from void, so the print shows the lab profile **as it is now** and a voided payment prints with its void mark. No permission is added: `payments.read` prints a receipt voucher, `expenses.read` an outgoing voucher (§6 decision 1).

### 1.1 Reuse, not duplication
- The renderer lives in `features/invoices/document/` next to `InvoiceDocument`, so the existing ESLint `no-restricted-imports` rule (no product logo, no `PRODUCT_NAME`) and the folder-reading test cover it with no new rule.
- Shared pieces extracted from `InvoiceDocument` and used by both: the lab header (`DocumentHeader`: logo + lab name, phone, address, slogan + title and meta box), the CSS variables / `safeStyle` / `pageRule`, `DocumentFrame`, the `inv-*` stylesheet, `printNow()`.
- Appearance: colours, font size and margins from the current invoice template (read with `settings.read`, defaults otherwise); lab name printed in the document language.

### 1.2 Screens
- `/payments/:id/voucher` («سند قبض») and `/outgoing/:id/voucher` («سند صرف»): the A4 preview, «طباعة», «حفظ PDF», label language switch (default = Settings documents language), back link, a «ملغى» note for a voided payment. `?print=1` prints once the logo and fonts are ready.
- Row action «طباعة السند» (a link to the preview, preview before print) on: payments report, the doctor's payments tab, the case payments panel, the outgoing report.

### 1.3 Content
Title (receipt voucher / payment voucher), voucher number, payment date, party block (doctor, or payee with the category; a doctor refund prints the doctor), amount in figures (lab currency, frozen decimals through `formatMoney`) **and in words** (ar / en), method (cash / transfer / cheque with number, bank, due date and status), bound case number, notes, two signature lines (receiver / accountant), void band with date and reason when voided; the number is never reused (the API already guarantees it).

### 1.4 Amount in words (`packages/shared/src/amount-words.ts`, tests first)
`amountInWords(minor, decimals, currencyCode, language)`, pure, integers and `BigInt`-free string arithmetic on numbers < 2^53 (max 999 999 999 999 minor).
- Known currencies (ILS, JOD, USD, EUR, EGP, SAR, AED) use their unit names with Arabic number/gender agreement (1 singular, 2 dual, 3–10 plural, 11–99 singular, 100+ singular; fem. «أغورة / هللة»); an unknown code or a decimals setting that does not match the currency's usual minor unit prints «N CODE و F/100» style (`{words} {CODE} and {F}/{10^decimals}`).
- Edge cases tested: 0.01, 0.99, 1.00, 2.00, 3.00, 11.00, 100.00, 101.01, 1000.50, 2,000.00, 2,000,000.00, 9,999,999,999.99, 0 decimals, 3 decimals, unknown code.

### 1.5 Tests
1. Failing first: `amount-words.test.ts` (shared) and `voucher-no-side-effects.e2e.spec.ts` (API: printing = the read endpoints; snapshot of ledger/balances/counters/row counts/audit before and after repeated reads equals; and voucher reads write nothing).
2. Web unit: renderer (both types, both languages, void mark, cheque block, case number, notes), injection (notes, doctor / payee name, bank, cheque number, void reason, category, lab fields: no script, no `on*`, no `img[src=x]`, `window.__pwned` undefined), no product name / logo, `lang` / `dir`, figures-in-words match, A4 print rule.
3. **Figures = stored amount for every demo payment and expense:** API e2e over the demo seed: each payment/outgoing row's `amount` formatted exactly as the voucher formats it (the shared `formatMoney`) and the words parse back (`wordsToMinor` test helper) to the stored minor units; the web renderer is covered by the same assertion in a component test over a table of amounts.
4. Playwright + axe (ar + en, print emulation): preview page, print media hides shell, only the lab's own logo, no product name, `page.pdf()` one A4 page, a voided voucher marked, screenshots → `docs/screenshots/b6b/`.

## 2. Part 2 — cleanups
a. Notifications region accessible name follows the language (unit test in both languages).
b. Snapshot size for a 200-case invoice and a 2 000-line statement — measured by a test/script, numbers in §5 and in production-readiness.
c. `outgoing.spec.ts` refund flake — loop of 20 runs with CI settings; cause or record.
d. production-readiness #23 — sequential reads when given a transaction, own commit only if small and every tie-out/invoice/statement test stays green; otherwise the exact proposed change is recorded in §5.

## 3. Order
1. Plan (this file). 2. Failing tests (words, no side effects) committed. 3. Words implementation. 4. Renderer refactor + voucher components + pages + row actions + i18n. 5. Tests (component, API, Playwright). 6. Cleanups a–d (d in its own commit). 7. Docs, screenshots, gates ×3.

## 4. Needs owner decision
| # | Question | Default built |
|---|---|---|
| V1 | Is a printed voucher a snapshot? | No: lab identity and appearance are the current ones; the payment itself is immutable. (An invoice-style snapshot would need a new table and a migration.) |
| V2 | Arabic wording of amounts (no diacritics, «شيكل / أغورة») | Plain standard wording; to be read once by an Arabic speaker on the owner's lab currency |

## 5. Measured / found
- **Snapshot size (cleanup b)**, `invoice-snapshot-size.e2e.spec.ts`: a 200-case invoice (3 teeth per case, Arabic names) = 96,067 bytes as text, 4,583 bytes stored (compressed jsonb), response 88,424 bytes, issue 95 ms, GET 10 ms. A 2,000-line statement (1,000 cases + 1,000 payments) = 443,266 bytes, 26,577 stored, response 399,597 bytes, issue 164 ms, GET 32 ms. Both far below the 1 MB cap: nothing to fix. Recorded in production-readiness #24 (input for B8).
- **Bug found by that measurement (fixed, own commits, test first):** the statement page ordered same-day items by the TEXT alias of the id (10 before 9) while the running balance summed in numeric order, so the running column did not add up and issuing such a statement as an invoice returned 500. Fix: `ORDER BY run.date, run.ord, run.ref_id`. Test `statement-order.e2e.spec.ts` (fails before, passes after).
- **Notifications region (cleanup a):** the region follows the language in a component test (ar → en → ar) and in the browser (`session-language.spec.ts`). I could not reproduce the stale Arabic name on this code (Sonner takes the label from `t()` on every render), so the tests pin the behaviour in both languages; no production code changed for it.
- **outgoing.spec.ts refund flake (cleanup c):** 20 runs in a loop (`--repeat-each=20 --retries=0`, CI=1, TZ=UTC, Chromium): 20 / 20 passed. Not reproducible, no cause found. Recorded, not changed.
- **#23 (cleanup d):** done in its own commit. `readAll` runs the reads of `doctorInputs` and `statement` one after the other inside a transaction and in parallel on the pool. `ledger-tx-reads.spec.ts` counted 5 overlapping queries before, 0 after. Tie-out (every demo doctor), property, mutation, invoices, immutability, numbering, delivery, payments and statements stayed green.

## 6. Decisions taken while unattended
1. **No API change and no new permission:** `payments.read` prints receipt vouchers, `expenses.read` payment vouchers (the owner-permission test is untouched).
2. **A voucher shows the current lab profile and logo** (not a snapshot), V1; the payment row itself is immutable except void.
3. **Document language** defaults to Settings (documents) and is switchable on the preview (labels and words only), like invoices.
4. **Amount in words:** plain Arabic without diacritics; known currencies ILS, JOD, USD, EUR, EGP, SAR, AED; an unknown code or unusual decimals prints «words CODE و 50/100». A zero major part prints «صفر شيكل».
5. **The row action opens the preview** (a link), not the print dialog; `?print=1` prints once.
6. **Shared pieces extracted** from InvoiceDocument: `DocumentHeader`, `documentVars`, `printNow`; the voucher lives in the same folder, so the product-logo lint rule and test cover it.
7. **Playwright:** the silent `/auth/refresh` POST is excluded from the "only GETs" check (session upkeep).
8. The statement ordering bug was fixed in this branch (small, test first) because the 2,000-line measurement exposed it.

## 7. Final gate (real output)
lint, typecheck, i18n:check (1,200 / 1,157), rtl:check, contract:check, build: exit 0. Shared 45/45; API unit 27 suites; integration 132/132 (15 suites); API e2e 466/466 (27 suites); web unit 357/357; Playwright + axe, CI=1, TZ=UTC, fresh databases, all projects: 97/97 three times, no retry. Screenshots: `docs/screenshots/b6b/`.
