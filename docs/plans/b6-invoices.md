# B6 — Invoices, immutable snapshots, void, invoice appearance and printing (plan)

Status: **draft for the owner's approval — planning only, no code, no migration.**
Branch: `feat/b6-invoices` (from `main` at `2d100c8`, after PR #14 (B5) and PR #15 (B5b)).
Sources read (2026-11-20): SPEC §1, §2.3, §3, §4, §5.1/5.2/5.6/5.8/5.14/5.15/5.18, §6.1, §7, §8, §9, §10, §11, §12 (owner answers 2026-11-06: no VAT, invoice numbering starts at a number the owner chooses and is settable only before the first invoice, lab name/logo/slogan from the lab profile); CLAUDE.md; ENGINEERING_STANDARDS; `docs/production-readiness.md`; `docs/plans/b3-payments.md`, `b4-debts-reports-search.md`, `b4b-outgoing-expenses.md`, `b5-delivery-notifications-backlog.md`; skills feature-workflow, money-ledger, db-migrations, security-review, `smile-artec-web-*`; `docs/reference/invoice-sample.html`. Code read: `case-rules.ts` (`canCancel`, `canEdit`, the S13 hook comment), `CasesService` lock order, `settings-rules.ts` (`COUNTER_NAMES` already has `invoice_no`, `withNewStart`, `isCounterLocked`), `SettingsRepository.hasMoneyData`, `schema/system.ts` (`settings`, `counters`, `lab_logo` single row, `audit_log`), `schema/cases.ts` (no `invoice_id` column today), `permissions.ts`, migration list 0000–0008, `GeneralSettingsPage.tsx` (invoice start number already editable until locked).

Provisional decisions this plan relies on (recorded in `docs/production-readiness.md`, pending Ibrahim's sign-off, **not blocking**): Q1, Q2 (cheques count only when cleared — owner-confirmed 2026-11-06), D2, D3, D9, X1–X3, X9.

---

## 0. Scope and where this plan departs from SPEC

**In:** the three invoice types of SPEC §5.14 with immutable JSON snapshots; void with a reason; invoice list; invoice appearance «مظهر الفاتورة» (template storage + live preview, §5.15); A4 printing / save as PDF through the browser; S13 enforcement (a case on an active invoice can be neither edited nor cancelled, including from «مرتجعة»); invoices in the currency-lock check (production-readiness #14); numbering from the owner's answer (already settable; B6 makes it consume, gap-free); Home «الفواتير» figure and live «إنشاء فاتورة» card; «مغلقة» chip; invoices CSV (SPEC §10).
**Out:** printing receipts (`IN-`) and outgoing vouchers (`OUT-`) — proposed **B6b** reusing the print shell (I9); server-side PDF (SPEC §12.17: the backend returns snapshot + template, the browser prints); VAT (owner: none); e-mail/WhatsApp (§3.2).

| # | SPEC says | This plan does | Why |
|---|---|---|---|
| P1 | §8: `cases.invoice_id` + voiding **deletes** `invoice_cases` rows | No `cases.invoice_id`. `invoice_cases` keeps its rows forever with an `active` flag; a partial unique index `(case_id) WHERE active` enforces "one active invoice per case" in the database | One source of truth; nothing financial is deleted (SPEC §0.1.5); the database, not only the service, refuses a second active invoice |
| P2 | §5.14: "optional invoice discount" | No discount typed on the invoice; the invoice's discount line = Σ the case discounts (I2) | An invoice-level discount would change what the doctor owes, i.e. the ledger, which §7.3 does not provide for |
| P3 | §5.14: free invoice "for one-off charges" | Document only; no effect on any balance (I1) | §7.3 has no term for it and a free-name party has no ledger (§7.2) |
| P4 | §8: `snapshot_json TEXT` | `snapshot jsonb` + `snapshot_sha256` over a canonical serialisation, checked on every read; database triggers refuse any change to issued content | "A snapshot never changes" proven by the database, not by convention |
| P5 | §5.14: lab logo "reference" in the snapshot | The logo bytes are frozen in a content-addressed `document_images` table; the snapshot holds the hash | `lab_logo` is one row that is replaced on change; a reference to it would change old invoices |

## 1. Invoice types and when each is used

| Type (code) | Arabic | Used when | Party | Marks cases invoiced | Money in the row | Ledger effect |
|---|---|---|---|---|---|---|
| `cases` | «فاتورة حالات» | Billing a doctor for finished work: pick a doctor → «حالات منجزة غير مفوترة» (status `delivered` or `ready`, not cancelled, not on an active invoice) → tick cases → notes → «إنشاء وطباعة» | doctor (required) | **yes** (one active invoice per case, «هذه الحالة مفوترة بالفعل.») | subtotal = Σ case line prices, discount = Σ case discounts, total = Σ case totals | **none** — the cases were charged when created (SPEC §7.3, §12.4) |
| `statement` | «كشف حساب» | Giving a doctor his account: doctor + optional date range → every case, payment, refund and returned cheque with a running balance and the closing balance | doctor (required) | no | none (closing balance lives in the snapshot; `subtotal/discount/total` NULL) | **none** |
| `free` | «فاتورة حرة» | A one-off document (e.g. a charge not tied to a case): party = a doctor from the list **or** a typed name, reason, amount > 0 | doctor or free name | no | subtotal = total = amount, discount 0 | **none** (default I1; alternative in §11) |

Common rules (SPEC §5.14, §7.6–7.8): one gap-free number series `invoices.no` for all three types (I3), issue date = lab today (I10), immutable after creation, void with a reason (stays listed as «ملغاة», its cases become un-invoiced), document language chosen at issue (default `settings.language.documents`, SPEC §6.1), `Idempotency-Key` required on creation.

## 2. Data model and migration outline (`0009_invoices.sql`)

Expand-only; no rewrite of existing rows. Drizzle schema in `shared/db/schema/invoices.ts` + `db:generate --name invoices`, SQL reviewed, hand-written blocks appended (triggers, permissions) like 0005/0007/0008.

### 2.1 `invoices`
| column | type / rule |
|---|---|
| `id` | bigint identity PK |
| `no` | bigint NOT NULL, unique (`invoices_no_uq`); from counter `invoice_no` |
| `type` | text NOT NULL CHECK in (`cases`,`statement`,`free`) |
| `doctor_id` | bigint NULL → doctors RESTRICT |
| `party_name` | text NULL, 1..100 (free invoice without a doctor) |
| `issue_date` | date NOT NULL (lab today) |
| `language` | text NOT NULL CHECK in (`ar`,`en`) |
| `currency_code` | text NOT NULL (snapshot of the locked currency, as on payments) |
| `subtotal`, `discount`, `total` | `amountColumn`, NULL only for `statement` |
| `status` | text NOT NULL default `active` CHECK in (`active`,`void`) |
| `void_reason` (1..300), `voided_at`, `voided_by` | NULL until void |
| `snapshot` | jsonb NOT NULL |
| `snapshot_version` | smallint NOT NULL (renderer contract version, starts at 1) |
| `snapshot_sha256` | text NOT NULL (hex of SHA-256 over the canonical JSON: sorted keys, no whitespace) |
| `logo_sha256` | text NULL → `document_images` RESTRICT |
| `idempotency_key` uuid NULL (unique partial), `request_hash` text NULL | as payments (B3 §5) |
| `row_version`, `created_at/by`, `updated_at/by` | `aggregateColumns()` |

CHECKs: `invoices_party_ck` — `cases`/`statement` need `doctor_id` and no `party_name`; `free` needs exactly one of `doctor_id` / `party_name`. `invoices_money_ck` — `(type = 'statement') = (total IS NULL)`, and for the others `subtotal − discount = total`, `total > 0` for `free`, `≥ 0` for `cases`. `invoices_void_ck` — void ⇔ `voided_at` ⇔ `void_reason`. `invoices_idempotency_ck` — key and hash both set or both null.
Indexes (each tied to a query): `(issue_date desc, id desc)` list; `(doctor_id, issue_date desc)` doctor filter and the doctor page; `(status, type)` Home count; unique `no`; unique partial `idempotency_key`.

### 2.2 `invoice_cases`
`invoice_id` → invoices RESTRICT, `case_id` → cases RESTRICT, `active boolean NOT NULL default true`, PK `(invoice_id, case_id)`. **Unique partial index `invoice_cases_active_case_uq (case_id) WHERE active`** — the database guarantees one active invoice per case. Void sets `active = false` on its rows (never deletes).

### 2.3 `document_images`
`sha256 text PK`, `mime_type` (png/jpeg), `size_bytes` (1..1 MiB), `content bytea`, `created_at`. Insert-if-absent at issue (`ON CONFLICT DO NOTHING`); a logo used by 500 invoices is stored once. Never updated or deleted.

### 2.4 Triggers (hand-written, one function each, tested)
- `invoices_guard` BEFORE UPDATE: only `status` (`active → void`, never back), `void_reason`, `voided_at`, `voided_by`, `row_version`, `updated_at/by` may change; anything else raises `invoice_immutable`. BEFORE DELETE raises.
- `invoice_cases_guard`: UPDATE only `active true → false`; DELETE raises.
- `document_images_guard`: UPDATE and DELETE raise.
B3 chose "no trigger" for the cheque/method rule (a service check sufficed); here immutability is the acceptance criterion of the milestone, so the database enforces it too.

### 2.5 Other changes in 0009
- Permissions `invoices.read`, `invoices.write`, `invoices.void`, granted to `owner` (+ `permissions.ts`). The template uses `settings.read` / `settings.write`. (`audit.read` stays a B8 item, production-readiness S25.)
- No new counter: `invoice_no` exists since 0001 with the owner-settable start (B1, addition C).
- No `settings` row for the template: absent = defaults (`rowVersion 0`); the first save inserts it.
- Tests: empty DB → 0009; DB at 0008 with the B5 demo → 0009 (rows untouched, permissions granted, triggers present).

### 2.6 Snapshot content (`snapshot_version = 1`) — what is frozen
Everything printed, so the web only renders (SPEC §5.14 "Backend implications"):
```
{
  version: 1, type, no, issueDate, language,
  lab:      { nameAr, nameEn, phone, address, slogan, logo: { sha256, mime } | null },
  currency: { code, symbol, decimals },
  party:    { kind: 'doctor', doctorId, name, clinic, phone } | { kind: 'free', name },
  layout:   { columns: [...visible column codes], widths: {...}, showLogo, showBalances, footerText },
  // cases
  cases:    [{ caseNo, patientName, receivedDate, deliveredDate, status, subtotal, discount, total, paid, remaining }],
  lines:    [{ caseNo, patientName, workTypeName, shade, unitPrice, qty, teeth: [11,12] , areas: ['upper_arch'], lineTotal }],
  totals:   { subtotal, discount, total },
  balances: { previous, current, pendingCheques },          // cases only
  period:   { from, to } | null, notes,
  // statement
  statement:{ from, to, periodOpening, lines: [{ date, kind, ref, description, debit, credit, running }], totals: { debit, credit }, closing, pendingCheques: [...] },
  // free
  free:     { reason, amount }
}
```
- **Frozen (copied at issue):** lab profile (both names, phone, address, slogan), the logo bytes (by hash), currency code/symbol/decimals, party name/clinic/phone, every line (work-type name snapshot, shade, unit price, teeth), case numbers, patient names, per-case totals and paid/remaining at issue, totals, balances at issue, statement lines and closing, notes, reason, language, the content part of the template (`layout`: visible columns, widths, show logo, show balances, footer text — I7).
- **Derived at render time (never stored, never changes a figure):** static labels (column headers, «فاتورة», area and kind labels) from the web catalog in the snapshot's language; colours, font size and margins from the **current** template (SPEC §5.14: "current template styling only for colours/fonts"); number formatting via `packages/shared` money with the frozen decimals.
- **Lines grouped** by case + work type + shade + unit price; `qty` = number of teeth/areas; `lineTotal = unitPrice × qty` (integer). Teeth sorted FDI order; area lines carry area codes.
- Integers only (minor units, ≤ `MAX_AMOUNT_MINOR` < 2^53, safe in JSON).
- Caps: ≤ 200 cases per invoice, ≤ 2 000 statement lines (beyond: `error.invoice.statement_too_long`, narrow the range), snapshot ≤ 1 MB.
- The **printed name** is chosen at render: document language `ar` → `nameAr` else `nameEn`; `en` → the reverse. Both are frozen so a reprint in the other language (SPEC §6.1) changes labels only.

## 3. Invoices, cases, payments and the doctor's balance

### 3.1 The rule
**Issuing or voiding an invoice of any type never changes the ledger.** The balance stays `opening + Σ non-cancelled case totals − counted received + counted refunds` (SPEC §7.3, B4b); invoices do not appear in `allocate`, `doctorBalance`, `balancesCte`, `breakdown`, the statement query, the receipts summary, cash flow or Home's ledger summary. SPEC says cases count **from creation** (§12.4), so a cases invoice is a document over charges that already exist. Invoices touch cases only through the "invoiced" flag (`invoice_cases.active`), which locks edits (§3.4).

### 3.2 Figures printed on a cases invoice
- `totals.subtotal` = Σ line totals; `totals.discount` = Σ case discounts; `totals.total` = Σ case totals = subtotal − discount. The service asserts `Σ cases.total = totals.total` before insert (500 `error.internal` + log if not).
- `balances.current` = the doctor's ledger balance at issue (`doctorBalance`, counted rule, under the doctor lock). `balances.previous = current − total` (I4). Identity: `previous + total = current`, tested.
- Per case: `paid`, `remaining` from `allocate()` at issue (frozen), and `pendingCheques` (memo, never in a sum).

### 3.3 Worked examples (2 decimals, minor units in brackets; reuse B4 §1.3 E1 so the plans cross-check)
Doctor E: opening 100.00; cases #201 (11-01) 300.00, #202 (11-02) 200.00, #203 (11-04) 150.00; cash 120.00 bound to #202, cash 250.00 unbound, transfer 60.00 bound to #203. #201, #202 delivered; #203 ready. Invoice start number set to 1001 before the first invoice.

**W1 — issue a cases invoice.** Before: balance (A) = 100 + 650 − 430 = **320.00** [32 000]; breakdown (B): opening 0, #201 rem 150, #202 rem 80, #203 rem 90 → 320 ✓; statement closing (C) 320.
Issue **1001** for #201 + #202: subtotal 500.00, discount 0, total **500.00** [50 000]; current 320.00; previous = 320 − 500 = **−180.00** (check: without #201/#202 the charges are 100 + 150 = 250 against 430 received → the lab owes 180 ✓); frozen per case: #201 paid 150 rem 150, #202 paid 120 rem 80 (230 + #203's 90 = 320 ✓).
After: A = **320.00**, B = 320, C = 320, `GET /debts` 320, cases list paid/remaining identical. Ledger unchanged.

**W2 — void and re-issue.** Void 1001 («خطأ في اختيار الحالات»): A = B = C = **320.00**; #201, #202 back in «حالات منجزة غير مفوترة»; 1001 stays listed «ملغاة», its snapshot byte-identical. Issue **1002** for #201 only: total 300.00, current 320.00, previous 20.00. The number 1001 is never reused.

**W3 — with a case discount.** Variant: #202 has discount 20.00 (case total 180.00). A = **300.00**. Invoice for #201 + #202: subtotal 500.00, discount 20.00, total 480.00, current 300.00, previous −180.00. Ledger still 300.00 after issue and after void.

**W4 — free invoice.** **1003** to doctor E, «أجرة توصيل», 25.00: A stays **320.00** (I1 default); the document prints no balances (`showBalances` ignored for `free`). Under the I1 alternative A would become 345.00 and the tie-out would gain a fourth term — not built unless the owner chooses it.

**W5 — statement and a later change.** **1004** statement of E, whole history, issued 11-20: closing **320.00** = A. Next day the 60.00 transfer is voided: A = 380.00, a new statement shows 380.00, **1004 still shows 320.00** (snapshot). 

**W6 — pending cheque.** Doctor H: case #401 200.00, cheque 200.00 bound, pending. Invoice 1005: total 200.00, current 200.00, previous 0, pending cheques 200.00 (memo). Cheque clears: A = 0; 1005 unchanged.

### 3.4 Effect on cases (S13 enforced)
| Action on a case on an **active** invoice | B6 rule |
|---|---|
| Edit header (patient, technician, dates, notes), lines, prices, discount | **refused** `409 error.case.invoiced` («الحالة مفوترة — ألغِ الفاتورة أولًا لتعديلها.»); `canEdit = false`, `editBlockedReason = 'invoiced'` |
| Cancel (any status, including from «مرتجعة» — S13) | **refused** `409 error.case.invoiced`; `canCancel = false` |
| Status change (e.g. delivered → returned → delivered), delivery dialog, collect date | allowed (SPEC §9: a return does not touch invoices) — I6 |
| Payments bound to it, cheque status, void payment | allowed; never touch the invoice |
`caseActions(status, invoiced)` gains the flag; `GET /cases/{id}` returns `invoice: {id, no} | null`; `GET /cases` items gain `invoiced` and the derived `closed` (delivered + invoiced + remaining 0 → «مغلقة» chip, SPEC §9).

### 3.5 Locks and races (ADR-0010 order)
Create: currency SHARE → doctor `FOR NO KEY UPDATE` → case rows `FOR UPDATE` in id order (+ re-check eligibility and `expectedTotal`) → `invoice_no` counter `FOR UPDATE` → insert invoice, `invoice_cases`, `document_images` → audit. Case edits already take currency → case `FOR UPDATE`, so an edit and an invoice serialise on the case row; the partial unique index is the last guard. Void: doctor → invoice row (`rowVersion`) → `invoice_cases` → audit. The client sends `expectedTotal` (what its preview showed); a different server total → `409 error.invoice.total_changed {total}` (staleness check, never truth).

### 3.6 Proof by tests (details §8)
Ledger-neutrality: every demo doctor's A, B, C, debts row, case paid/remaining, receipts summary and Home ledger summary are equal before and after issuing and after voiding every invoice type (extends `ledger-tieout.e2e.spec.ts`), plus a property test over random ledgers and random issue/void sequences, plus a mutation check (a test-only injected invoice charge must make it fail).

## 4. Void

- `POST /invoices/{id}/void {rowVersion, reason}`; permission `invoices.void`; reason required, 1..300, trimmed.
- Effect, one transaction: `status = void`, `voided_at/by`, `row_version + 1`, its `invoice_cases.active = false`; snapshot, number and totals untouched (triggers). Already void → `409 error.invoice.already_void`; stale → `409 error.concurrency.stale`.
- Allowed at any time, whatever the payments (they are not linked to invoices). A voided statement or free invoice has no case effect.
- Audit `invoice.voided {invoiceNo, type, reason}`; `invoice.created {invoiceNo, type, party, total?, caseCount?}`; `invoice_template.updated {changed: [keys]}`. Patient names never in the audit (B2). The Home feed gets labels `home.activity.action.invoice.*` and `auditEntity` whitelists `invoiceNo`.
- Display: list row struck through with «ملغاة» + reason; the document view shows a «ملغاة» band on screen **and** in print (a reprint of a void invoice is visibly void).

## 5. Template storage «مظهر الفاتورة»

`settings` key `invoice_template` (jsonb, `row_version`), validated by one strict schema (unknown keys rejected, class-validator at the boundary + a pure `validateTemplate` used by tests):

| Setting | Values | Applies to |
|---|---|---|
| `primaryColor`, `headerTextColor`, `tableHeaderColor` | `^#[0-9A-Fa-f]{6}$` only | render (current) |
| `fontSize` | `s` / `m` / `l` (9.5 / 10.5 / 11.5 pt) | render (current) |
| `margins` | top/end/bottom/start, integer mm 5..30 | render (current) |
| `columns` | ordered subset of the fixed codes `caseNo, patient, teeth, workType, shade, qty, unitPrice, lineTotal`; `lineTotal` cannot be hidden | frozen at issue |
| `widths` | per column, integer mm 8..80 or null (auto) | frozen at issue |
| `showLogo`, `showBalances` | boolean | frozen at issue |
| `footerText` | plain text 0..300, ≤ 3 lines | frozen at issue |

**Fixed (not configurable):** layout order (header, title + meta box, party block, lines, totals, notes, signatures, footer), the lab identity source (lab profile only), the font family (bundled Cairo), A4 portrait, the totals arithmetic, the «ملغاة» band, page numbers.
**Safe rendering:** no HTML, CSS or URL is ever stored or accepted. Colours reach the page only as CSS custom properties set from validated hex values through React's `style` object; numbers through typed values; all user text (lab profile, names, notes, footer) rendered as React text (escaped), line breaks by `white-space: pre-line`. No `dangerouslySetInnerHTML` (lint), no `eval`, CSP unchanged (`default-src 'self'`, images `'self' blob:`). The logo comes from `GET /invoices/{id}/logo` (`image/png|jpeg`, `nosniff`) as a blob URL, revoked on unmount. A contrast warning (not a block) when header text on the header colour is below 4.5:1.
`GET /settings/invoice-template` → `{template, rowVersion}` (defaults when absent, rowVersion 0); `PUT /settings/invoice-template {rowVersion, template}` → 200, stale → 409. Toast «تم حفظ إعدادات أعمدة الفاتورة.»

## 6. Printing

- **One renderer**, `features/invoices/document/InvoiceDocument.tsx`, used by the invoice view, the creation preview and the appearance preview (SPEC §5.15: "the same renderer"). Input: snapshot + current template styling. Sub-renderers per type; shared header/footer.
- **A4 and the print stylesheet:** `@page { size: A4; margin: <template margins> }`; `@media print` hides the app shell (sidebar, top bar, toasts, buttons); the document is the only printed element. Tables: `thead { display: table-header-group }` (header repeats), `tr { break-inside: avoid }`, totals box and signatures `break-inside: avoid`. Page numbers «صفحة n من m» via `@page` margin boxes (`counter(page)`/`counter(pages)`, Chromium ≥ 131 — Edge on Windows); verified in stage 0, fallback: no page numbers on screen preview, footer counter only when printed.
- **Arabic RTL / English LTR:** the document sets its own `lang` and `dir` from the snapshot language (independent of the UI language); logical CSS only (`rtl:check`).
- **Numbers and money:** Western digits (SPEC §1); money through `packages/shared` `formatMoney` with the frozen decimals and symbol, in one LTR isolate (`Money`), `font-variant-numeric: tabular-nums`, money columns at the reading end (`Td kind="money"`), counts and case numbers `kind="number"`, teeth lists `num`.
- **Embedded fonts:** Cairo is bundled locally (offline); printing waits for `document.fonts.ready` before `window.print()`.
- **Preview before print:** the invoice page shows the A4 page(s) at screen scale with «طباعة» and «حفظ PDF» (both open the browser print dialog; PDF = the dialog's "Save as PDF", no server PDF — SPEC §12.17). The creation flow shows a preview (`POST /invoices/preview`, no number) before «إنشاء وطباعة».
- **Totals check (SPEC §5.14):** before rendering, the web recomputes Σ line totals, discount and total from the snapshot lines with the shared `invoiceTotals()` (the same pure function the API used) and compares with `snapshot.totals`; mismatch → the document is not shown, print is disabled and the alert «الإجمالي المعروض لا يطابق حساب البرنامج — راجع البنود.» appears.
- **Only the lab's own identity (requirement d):** the header prints the frozen lab logo (if any and `showLogo`) and the lab name; no logo → name only (SPEC §2.3, never a fallback image). The print components never import the product logo (`assets/brand/basma-*`) or `PRODUCT_NAME`, and no «Powered by» line; an ESLint `no-restricted-imports` rule on `features/invoices/document/**` plus tests enforce it.

## 7. API and screens

### 7.1 API (`/api/v1`, Bearer, DTO-validated, unknown fields rejected, error envelope with stable codes in ar/en)
| # | Method + path | Permission | Request → response | Errors (beyond 400/401/403) |
|---|---|---|---|---|
| 1 | `GET /invoices/eligible-cases?doctorId&page` | invoices.read + cases.read | → `Page<{caseId, caseNo, patientName, receivedDate, deliveredDate, status, total, paid, remaining}>` | 404 doctor |
| 2 | `POST /invoices/preview` | invoices.write | same body as #3 → `{snapshot}` without `no` | as #3 except idempotency |
| 3 | `POST /invoices` + `Idempotency-Key` | invoices.write (+ cases.read for `cases`, + ledger.read for balances/statement) | `{type:'cases', doctorId, caseIds[1..200], notes?, expectedTotal, language?}` \| `{type:'statement', doctorId, from?, to?, language?}` \| `{type:'free', doctorId? \| partyName?, reason, amount, language?}` → 201 `InvoiceDetail`; replay 200 + `Idempotent-Replayed` | 404; 409 `invoice.case_already_invoiced {caseNo}`, `invoice.case_not_eligible {caseNo}`, `invoice.case_doctor_mismatch`, `invoice.total_changed {total}`; 400 `invoice.statement_too_long`, `invoice.party_required`, `idempotency.required`; 422 `idempotency.mismatch` |
| 4 | `GET /invoices` | invoices.read | `?type&status&doctorId&from&to&search(no, doctor or party name)&sort&page&pageSize` → `Page<InvoiceListItem>` | — |
| 5 | `GET /invoices/summary` | invoices.read | → `{active: {cases, statement, free}, void}` (Home card) | — |
| 6 | `GET /invoices/{id}` | invoices.read | → `{id, no, type, status, issueDate, language, totals, voidReason, voidedAt, voidedBy, snapshotVersion, snapshot, rowVersion}`; hash checked on read (mismatch → 500 + log) | 404 |
| 7 | `GET /invoices/{id}/logo` | invoices.read | → image bytes of the frozen logo | 404 (no logo) |
| 8 | `POST /invoices/{id}/void` | invoices.void | `{rowVersion, reason}` → `InvoiceDetail` | 404; 409 `invoice.already_void`, `concurrency.stale` |
| 9 | `GET /settings/invoice-template`, `PUT /settings/invoice-template` | settings.read / settings.write | §5 | 409 `concurrency.stale` |
| 10 | `GET /cases/{id}`, `GET /cases` (additive) | cases.read | `invoice`, `invoiced`, `closed`, `editBlockedReason` | — |
| 11 | `PATCH /cases/{id}…`, `POST /cases/{id}/cancel` (changed) | as today | refused when invoiced | 409 `case.invoiced` |
| 12 | `GET /exports/invoices` | invoices.read + exports.run | CSV of the filtered list (B4 rules: BOM, formula-safe, audited, 50 000 cap) | — |
| 13 | `PATCH /settings/numbering` (unchanged) | settings.write | `invoiceNoStart` refused once 1 invoice exists (`isCounterLocked`, already built) | 409 existing code |
`hasMoneyData` gains `OR EXISTS (SELECT 1 FROM invoices)`. New catalog keys (ar + en): `error.invoice.*`, `error.case.invoiced`, `invoice.type.*`, `invoice.status.*`, `audit.invoice.*`, `audit.invoice_template.updated`, CSV headers. `openapi:export` + `api:generate` committed; `contract:check` clean.

### 7.2 Screens (skills `smile-artec-web-*`, `frontend-design` for the document and the appearance page)
- **Sidebar:** «إنشاء فاتورة» and «مظهر الفاتورة» appear (SPEC §4 items 8, 9) once their screens work.
- **«الفواتير» list** `/invoices`: type and status chips, search, date range, doctor filter, CSV; row → view. `useUrlState` filters, `DataTable`.
- **«إنشاء فاتورة»** `/invoices/new`: type choice (three cards), then per type: cases (doctor picker → eligible cases table with select-all, notes, preview, «إنشاء وطباعة»; empty «لا توجد حالات بانتظار الفوترة.»); statement (doctor + optional range → preview → «إصدار كشف الحساب»); free (doctor or typed name, reason, `MoneyField`) — one Idempotency-Key per attempt; after success go to the invoice view and open print.
- **Invoice view** `/invoices/:id`: A4 preview, «طباعة», «حفظ PDF», reprint language switch (labels only), «إلغاء الفاتورة» (`ActionButton` + reason dialog, focus returns), void band.
- **«مظهر الفاتورة»** `/invoice-appearance`: settings form start side, live preview end side with sample data («عيادة تجريبية», «تاج زيركون», «جسر خزف») through the same renderer; save with rowVersion.
- **Elsewhere:** doctor account «كشف حساب» → `/invoices/new?type=statement&doctor=`; case details shows the linked invoice and the reason edits are blocked (`ActionButton disabledReason`); cases list «مفوترة» / «مغلقة» chips; Home «الفواتير» figure and live «إنشاء فاتورة» card; `refreshMoney` + a new `invoiceKeys` family invalidated after invoice writes and after case writes.

## 8. Test plan

**Unit (pure):** line grouping (same case/type/shade/price merged, teeth FDI order, areas), `invoiceTotals` (0/2/3 decimals, MAX bounds), balances identity `previous + total = current`, eligibility (each status, cancelled, already invoiced, other doctor), `caseActions` with `invoiced`, canonical JSON + hash (key order independent), template validation (every field, bad hex, unknown key, `lineTotal` hidden refused, footer length/lines), printed lab name choice per language, statement line cap.
**Integration (Testcontainers PostgreSQL 16):** migration 0009 on empty and on 0008 + data; **triggers:** direct `UPDATE invoices SET snapshot …`, `… total …`, `… no …`, `status void → active`, `DELETE` on all three tables each raise; partial unique index refuses a second active invoice for a case; **concurrency:** two invoices with the same case in parallel (one 201, one 409, one row), invoice vs case edit on the same case (serialised, one 409), invoice vs currency change, void vs case edit, N parallel creates → numbers contiguous from the chosen start, forced failure after taking the number → number reused, same Idempotency-Key twice → one row; `hasMoneyData` true after a first free invoice alone.
**API e2e (Supertest):** 401/403 on every route; every new error code in ar and en; W1–W6 with exact integers; numbering: start 1001 set → first invoice 1001 → changing the start → 409; void and re-issue; S13: edit/cancel (pre-delivery and from returned) of an invoiced case refused, allowed again after void; status return and delivery allowed while invoiced; **ledger neutrality** for every demo doctor (A = B = C and debts/case figures/receipts/Home summary identical before, after issue of each type, after void) + property test (200 runs, fixed seed printed) + mutation check; `TZ=UTC` with a non-UTC lab zone (issue date = lab today around midnight).
**Snapshot immutability (the acceptance test, `invoice-immutability.e2e.spec.ts`):** issue one invoice of each type, record `GET /invoices/{id}` bytes, hash and logo bytes; then change: doctor name/clinic/phone; work-type name and general price; the doctor's special price; lab profile (both names, phone, address, slogan); replace and then remove the logo; template colours, columns, footer; currency symbol; document language; case status (return, re-deliver), collect date; add, void and bounce payments; void the cases invoice and then edit the case's lines, discount and patient name; **assert** every snapshot, hash, number, total and logo byte is unchanged, and the voided invoice's snapshot too. Also: a direct SQL update is refused (trigger).
**Web unit/component (Vitest):** renderer (each type, columns/widths, no logo → name only, no product logo or name anywhere, totals mismatch → alert and print disabled, void band, `lang`/`dir` from the snapshot), appearance form (inline Arabic errors, contrast warning, stale 409), creation flows (empty state, select-all, key reuse on retry, double click sends once, `total_changed` message), void dialog (reason required, focus return), i18n parity, RTL guard.
**E2E (Playwright + axe, ar and en, `TZ=UTC`, own data with `uid()`):** create → preview → issue → print view for each type; void → case editable again → re-issue; appearance change shows in the preview and in an old invoice's colours but not its columns; print media emulation (`page.emulateMedia({ media: 'print' })`): shell hidden, header row repeats on a 60-line invoice, `page.pdf()` page count ≥ 2; no `img` other than the lab logo and no product name in the document; `expectAccessible` on every new page and dialog, and at 390 px (`responsive.spec.ts` routes list); screenshots in both languages (`docs/screenshots/b6/`). **first-run:** invoice start number editable before the first invoice, locked after it.
**Contract drift:** `npm run contract:check`.

## 9. Demo seed additions (`apps/api/scripts/demo`, through the API only)
- Set the invoice start number to **1001** before the first invoice (demo of the owner rule).
- Cases invoices for 4 doctors over their delivered/ready cases, one including a case with a discount and one with a pending cheque; leave some delivered cases un-invoiced so «حالات منجزة غير مفوترة» is not empty.
- One invoice voided with a reason and its cases re-issued on a new number.
- Two statements (one whole history, one with a range); two free invoices (one to a doctor, one to a typed name).
- `demo-seed.spec.ts`, `home-demo.spec.ts` (Home «الفواتير» compared with `GET /invoices/summary`) and the tie-out test updated in the same commit; the tie-out test asserts invoices of all three types and one void exist and the ledger is neutral.

## 10. Order and gates (one branch, backend then frontend)

**Stage 0 — checks, no product code (≈ ½ day):** confirm the case-edit lock path in `CasesService` matches §3.5; confirm the statement query can be reused for the snapshot (and its line cap); confirm `@page` margin boxes and `page.pdf()` in the installed Edge/Chromium; confirm Cairo prints from the bundle offline; measure snapshot size for a 200-case invoice and a 2 000-line statement; bundle size baseline.
**Stage 1 — backend, one logical change per commit, failing tests first where a rule changes behaviour:** (1) pure rules (grouping, totals in `packages/shared`, eligibility, hash, template validation) + tests; (2) migration 0009 + schema + triggers + migration/trigger tests; (3) S13: `caseActions(…, invoiced)`, `error.case.invoiced` on edit/cancel (failing test first); (4) create / preview / list / summary / get / logo; (5) void; (6) `hasMoneyData` + numbering consumption tests; (7) template endpoints; (8) CSV, audit labels, OpenAPI, client, catalogs, demo seed.
**Gate 1** (real output reported): lint, typecheck, i18n:check, unit, integration, API e2e (tie-out, neutrality, immutability), build, contract:check.
**Stage 2 — web:** renderer + print stylesheet; invoice view; creation flows; list; appearance page; case/Home/doctor changes; sidebar items; component tests; Playwright + axe + screenshots.
**Gate 2:** Gate 1 + web tests, rtl:check, `test:e2e:web` (all Playwright projects, ar + en, `TZ=UTC`), bundle size after.
**Docs in the last commit:** SPEC edits (§5.14 departures P1–P5, §8 `invoices` / `invoice_cases` / `document_images`, §11 B6 row), production-readiness (#14, S13 done), skills `money-ledger` (invoices are ledger-neutral, lock order), `db-migrations` (immutability triggers), `web-api-data` / `web-testing-a11y` (renderer, print tests), build notes in this plan. No push; PR only after the owner's go-ahead.

## 11. Risks and "Needs owner decision"

### Risks
1. **Ledger leakage** — an invoice term slipping into a balance query. Mitigation: invoices never joined by ledger code; neutrality e2e + property + mutation tests.
2. **Snapshot drift** — any code path that updates issued content. Mitigation: triggers, hash on read, the immutability e2e.
3. **Browser print differences** (margin boxes, page breaks) between Edge versions. Mitigation: stage-0 check, Chromium PDF test in CI, graceful fallback without page numbers.
4. **Large statements** — slow snapshot or huge JSON. Mitigation: 2 000-line cap with a clear message; measured in stage 0.
5. **Case edits blocked** may surprise the owner (a typo after invoicing needs void + re-issue). Mitigation: the blocked reason is shown with a link to the invoice (SPEC rule).
6. **Logo storage growth** — one copy per distinct logo, ≤ 1 MB each; negligible.
7. **Scope** — receipts/voucher printing in B6b, not here.

### Needs owner decision (each has a recommended default; approving the plan without comment = defaults)
| # | Question | Default (recommended) | Alternative |
|---|---|---|---|
| **I1** | Does a «فاتورة حرة» to a doctor change what he owes? | **No** — a document only; prints no balances (SPEC §7.3 has no term for it; free-name parties have no ledger). | Yes: a dated charge item in the FIFO like a refund (SPEC §7.3 change, tie-out gains a term, void reverses it). |
| **I2** | Invoice-level discount. | **None typed on the invoice**; its discount line = Σ case discounts (give a discount on the case before invoicing). | A real invoice discount that lowers the debt (ledger credit item, SPEC §7.3 change). |
| I3 | Number series for «كشف حساب». | **Same series** as invoices (SPEC §8: one `invoices.no`). | A separate series for statements. |
| **I4** | «الرصيد السابق / الرصيد الحالي» on a cases invoice. | Current = the doctor's balance at issue; previous = current − invoice total (can be negative = credit). | Print only the current balance. |
| I5 | Which cases can be invoiced. | Delivered or ready (SPEC), not cancelled, not on an active invoice. | Delivered only. |
| I6 | What an invoice locks on its cases. | Edits of header, lines, prices, discount and cancel are refused; status changes, delivery, collect date and payments stay allowed (SPEC §9). | Also block status changes. |
| I7 | Reprint after the appearance changes. | Content and layout choices (columns, widths, logo on/off, balances on/off, footer) are frozen; colours, font size and margins follow the current appearance (SPEC §5.14 wording). | Freeze everything, including colours. |
| I8 | Home «الفواتير» count. | Active cases + free invoices (statements listed but not counted). | Count all three types. |
| I9 | Printing receipts (`IN-`) and outgoing vouchers (`OUT-`). | **B6b**, right after B6, reusing the print shell. | Inside B6 (bigger branch). |
| I10 | Invoice issue date. | Lab today only (no back-dating), so numbers and dates always rise together. | Allow a past date (not before the last invoice's date). |
| I11 | Document language. | Default from Settings, changeable on the creation screen; a reprint can switch labels only. | Always the Settings value. |

Still waiting on Ibrahim (provisional, not blocking): Q1, Q2 (Q2 owner-confirmed 2026-11-06), D2, D3, D9, X1–X3, X9.
