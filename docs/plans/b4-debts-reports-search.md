# B4 — Debts breakdown, reports, CSV export and global search (plan)

Status: **proposed, waiting for the owner.** Planning only: no code and no migration is written yet.
Branch: `feat/b4-debts-reports-search` (from `main` after PR #11, B3).
Sources read: SPEC §3, §4, §5.1/5.8/5.9/5.11/5.13/5.17, §6, §6.1, §7, §8, §10, §11, §12; CLAUDE.md; ENGINEERING_STANDARDS §4 (performance); `docs/production-readiness.md` (item 15, S10, S11, S12, S7/S8); `docs/plans/b3-payments.md`; ADR-0011 (installer, portable PostgreSQL); the skills money-ledger, db-migrations, feature-workflow, security-review and the `smile-artec-web-*` set; the B3 code (`LedgerService`, `LedgerRepository`, `payment-rules.ts`, `PaymentsRepository`, `CasesRepository`, `DoctorsRepository`, `DebtsPage`, `url-state.ts`, the demo seed).

## 0. Scope and where this plan departs from SPEC / B3

**In:** debts breakdown (modal) with CSV; doctor statement improvements and CSV; receipts report (summary on the payments page) and payments CSV; paid/remaining per row in the cases list; balance column in the doctors list; global search (cmdk); the pg_trgm decision (production-readiness #15).
**Out:** expenses report and outgoing payments (see §3 and decision O1), refunds of credit (S10), printing/receipts/PDF (B6), invoices, notifications feed (B5), CSV of cases/cheques/doctors lists (not requested; SPEC §10's "all tables export to CSV" is met for the three money reports now and the others can reuse the same CSV module later).

| # | SPEC / B3 says | This plan does | Why |
|---|---|---|---|
| P1 | §11: B4 includes the **expenses report** | not built unless the owner picks option (a) in §3 | B3 built no outgoing payments, so there is nothing to report. |
| P2 | §5.17: results grouped «doctors / cases» | groups **doctors / cases / payments**; "patients" are matches on the case's patient name (no patient record exists, SPEC §12.1) | The brief asks for vouchers too. |
| P3 | §5.17: "no exact match → show closest matches" | closest = word-by-word and Arabic-folded matching, not typo tolerance, unless the owner picks pg_trgm (O4) | See §5. |
| P4 | §5.11 modal lists "payments list" | modal shows the 10 latest payments plus a link to the doctor's payments tab | A doctor can have thousands; the full list already exists. |
| P5 | B3 plan: `GET /doctors/{id}/statement` lines carry a bare `ref` number | additive fields on statement lines (§2.3) | A statement line must be readable in the UI and in CSV. |

## 1. Debts breakdown and the tie-out rule

### 1.1 What the breakdown shows (per doctor)
`GET /doctors/{id}/debt-breakdown` returns, all computed at read time from the same `allocate()` the case page uses:

1. **Header figures** — opening balance, Σ non-cancelled case totals, received (counted payments), pending cheques (memo only, never in the sum), **balance** + direction. These are the figures of `GET /doctors/{id}/balance`.
2. **Opening line** — the part of a positive opening balance still unpaid (`openingRemaining`; D4 of B3: it is the oldest FIFO item).
3. **Open cases** — every non-cancelled case with `remaining > 0` (unpaid or partly paid), oldest first (received date, then case no.): case no., patient, received date, status, total, paid, remaining. Paged (25) for the list; the totals below always cover **all** open cases, not the page.
4. **Credit** — money the lab holds for the doctor (overpayment, payments bound to cancelled cases, a negative opening balance). Shown as a negative line.
5. **Equation** — `openingRemaining + Σ remaining(open cases) − credit = balance`, printed in the modal footer so the owner can see it add up.
6. **Latest 10 payments** (counted or not, with a `counted` flag, voided ones hidden) and a link to the full list.

Permissions: `ledger.read` **and** `cases.read` (the breakdown carries patient names; production-readiness #19). A caller with only `ledger.read` still gets the balance and the statement, not the breakdown.

### 1.2 The tie-out rule (the acceptance criterion)

For every doctor, at any moment, the three independent computations agree:

```
(A) balance            = opening + Σ non-cancelled case totals − Σ counted payments        (doctorBalance, SQL balancesCte)
(B) breakdown equation = openingRemaining + Σ remaining(all live cases) − credit           (allocate)
(C) statement closing  = opening + Σ debits − Σ credits over the whole history             (statement query, no date range)
A = B = C
```
Why B = A (proof, so the test is not a coincidence). Let `o` = opening, `T` = Σ live case totals, `R` = Σ counted payments, `P` = Σ paid on live cases, `u` = part of the positive opening that got paid, `c` = pool left over.
`R = P + u + c` (every counted unit goes to a case, to the opening, or stays in the pool) and `credit = c + max(−o, 0)`; `Σ remaining = T − P`; `openingRemaining = max(o,0) − u`.
`Σ remaining + openingRemaining − credit = T − P + max(o,0) − u − c − max(−o,0) = o + T − R = A`. ∎

The service **asserts** B = A before answering; a mismatch is a bug, so it logs an error and returns `500 error.internal` (never wrong numbers on screen). The response includes the four terms (`tieOut`) so the web can print the equation and the CSV can end in a column whose sum equals the balance (§2).

### 1.3 Worked examples (minor units in brackets, 2 decimals)
Examples 1–3 reuse B3 §2 so the two plans can be checked against each other.

**E1 — B3 example 2 (opening, bound + unbound, then a cancelled case).** Doctor E, opening 100.00 [10 000]. Cases #201 (11-01) 300.00, #202 (11-02) 200.00, #203 (11-04) 150.00. Payments: cash 120.00 bound to #202; cash 250.00 unbound; transfer 60.00 bound to #203.
Balance (A) = 100 + 650 − 430 = **320.00** [32 000].
Breakdown: bound first — #202 paid 120 (rem 80), #203 paid 60 (rem 90); pool 250 pays the opening 100 (openingRemaining 0), then #201 150 (rem 150). Open cases: #201 150.00, #202 80.00, #203 90.00; openingRemaining 0; credit 0.
(B) = 0 + (150 + 80 + 90) − 0 = **320.00** ✓.
After **cancelling #203**: A = 100 + 500 − 430 = **170.00**. The 60 joins the pool (310): opening 100, #201 gets 210 (rem 90), #202 rem 80. (B) = 0 + (90 + 80) − 0 = **170.00** ✓. The 60.00 payment is shown in the payments list as "bound to a cancelled case — kept as credit" but it is not in `credit` here because it was absorbed by the open items; `credit` is only what the pool could not place.

**E2 — B3 example 1 (cheque lifecycle).** D: cases #101 400.00, #102 300.00; cheque 500.00 unbound.
- Pending: A = 700.00; open cases 400 + 300; pending cheques 500.00 shown apart; (B) = 700 ✓.
- Cleared: A = 200.00; #101 paid 400 (rem 0, not listed), #102 paid 100 (rem 200); (B) = 200 ✓.
- Returned: A = 700.00; both cases fully open again; (B) = 700 ✓.

**E3 — overpayment (B3 example 3).** F: case 100.00, cash 150.00 unbound. A = **−50.00** [−5 000]. Case rem 0 (not listed); openingRemaining 0; credit 50.00. (B) = 0 + 0 − 50 = −50 ✓. The modal shows no open cases, a credit line «−50.00» and the direction «مستحق عليّ».

**E4 — negative opening balance (new).** G: opening **−50.00**, case #301 100.00, cash 30.00 unbound. A = −50 + 100 − 30 = **20.00** [2 000]. A negative opening is not a FIFO item (B3 §2); the 30 pays #301 (paid 30, rem 70); credit = 0 (pool) + 50 (negative opening) = 50. (B) = 0 + 70 − 50 = **20.00** ✓.

**E5 — pending cheque never enters the sum.** H: case 200.00, cheque 200.00 pending. A = 200.00; open case rem 200; pending cheques 200.00 (memo). (B) = 200 ✓. When the cheque is cleared: A = 0, no open case.

### 1.4 The test that asserts it for every demo doctor
`test/e2e/ledger-tieout.e2e.spec.ts` (API e2e, Supertest, Testcontainers): start the app on an ephemeral port, run the demo seeder (`scripts/demo/seed.ts`, which talks to a real HTTP API) into the empty test DB, then for **every doctor** (all 15 plus the demo additions of §7):
1. `GET /doctors/{id}/balance` → `balance`;
2. `GET /doctors/{id}/debt-breakdown`, paging through **all** pages of open cases → `openingRemaining + Σ remaining − credit`;
3. `GET /doctors/{id}/statement` with no range, last page → `closing`;
4. the SQL `balancesCte` (through `GET /debts`, `direction=all`) → balance;
5. assert 1 = 2 = 3 = 4 (integers, `toBe`), and `Σ open-case remaining` over the pages equals the `tieOut.casesRemaining` of the header.
Plus the same assertions in a **property test** over random generated ledgers (random opening ±, cases, bound/unbound payments, cancelled cases, cheques in every state, voids), 200 runs with a fixed seed printed on failure, and a **mutation check**: a deliberately wrong allocation (test-only injected) must make the test fail, so the test is known to bite. If the seeder cannot run inside Jest (to be confirmed in stage 0; it only needs `baseUrl`, username, password), the fallback is a generated fixture through the API with the same assertions, and the Playwright `demo` project asserts the same equality through the UI (§7).

## 2. CSV export

### 2.1 Endpoints and rules (one `ExportsController`, one `CsvWriter`)
| Report | Path | Filters honoured (same names as the list) | Needs |
|---|---|---|---|
| Debts | `GET /exports/debts` | `direction`, `search` | `ledger.read` + `exports.run` |
| Debt breakdown of a doctor | `GET /exports/doctors/{id}/debt-breakdown` | — (all open cases) | `ledger.read` + `cases.read` + `exports.run` |
| Doctor statement | `GET /exports/doctors/{id}/statement` | `from`, `to` | `ledger.read` + `exports.run` |
| Payments (receipts) | `GET /exports/payments` | `doctorId`, `caseId`, `method`, `status`, `counted`, `from`, `to`, `search` | `payments.read` + `exports.run` |

Every export reuses the list's repository query and filter function (one source of truth: the CSV can never disagree with the screen); the web passes the current URL filters. Unknown query keys → 400 (whitelist DTO). Paging parameters are not accepted: an export is the whole filtered set.

- **Encoding:** `Content-Type: text/csv; charset=utf-8`, body starts with the UTF-8 BOM `EF BB BF` so Excel reads Arabic correctly (SPEC §10). Line ends CRLF (RFC 4180), fields quoted when they contain the delimiter, `"`, CR or LF; `"` doubled.
- **Delimiter:** comma (O2). Not auto-detected by Excel in every regional setting: the stage-0 check opens the three files in the owner's Excel; if his list separator is `;` we switch the default (one constant) rather than ship a file that opens in one column.
- **Language:** headers and enum labels (direction, method, status, type) come from catalogs `csv.<report>.<column>` / existing `payment.method.*`, `cheque.status.*`, `debts.direction.*` in `ar.json` and `en.json`; language = `lang` query parameter, else `Accept-Language`, fallback `ar` (same as every other API message). Data the user typed (names, notes) is exported as typed. Both languages have a test on the header row.
- **Money:** exact decimal text from integer minor units with the installation's decimals (`toMoneyInput` of `packages/shared`, string arithmetic on the integer, never `/ 100`, never `toFixed`, never a float): `12345` with 2 decimals → `123.45`, `-5000` → `-50.00`, `5` with 3 decimals → `0.005`, 0 decimals → `5`. Dot decimal separator, no thousands separator, no currency symbol, Western digits, so Excel treats the cell as a number and `SUM` works. The currency code is in the header (`Amount (ILS)` / `المبلغ (ILS)`). Debit/credit/remaining/balance keep their sign as stored; no "negative in brackets".
- **Dates:** ISO `YYYY-MM-DD` (SPEC §6), lab-local dates exactly as stored (no time-zone conversion, so `TZ=UTC` and a non-UTC lab zone give identical files). Timestamps are not exported.
- **Text safety (CSV/formula injection):** a **text** cell (names, patient, bank, notes, cheque no., void reason) starting with `=`, `+`, `-`, `@`, TAB or CR gets a leading `'`. Numeric cells are produced by the server from integers and are never altered, so a negative amount stays a number. Tested with `=1+1`, `@SUM(A1)`, `-2+3`, a leading TAB and an Arabic name.
- **No phone numbers or ids in the files** (Excel strips leading zeros; ids are not useful to the owner).
- **File name:** ASCII only, from `PRODUCT_NAME` and the lab date, e.g. `basma-debts-2026-11-16.csv`, `basma-statement-<doctorId>-2026-11-01_2026-11-30.csv`; `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. A doctor's name is never put in the file name.
- **Size and cost limits:** at most **50 000 data rows** per export (the SPEC scale is 20 000 cases / 50 000 payments); more → `422 error.export.too_large` with `{limit, rows}` and the message asks the user to narrow the filters. The file is built in memory (≤ ~10 MB at the cap) inside **one read-only `REPEATABLE READ` transaction**, read in keyset batches of 2 000 rows, so the rows and any totals come from one snapshot and memory stays bounded. A per-user limit of 10 exports per minute (existing rate-limit mechanism if it applies to authenticated routes; otherwise a small in-memory limiter, like B0's) → `429`.
- **Audit (SPEC §3.3, §7.6):** the entry `export.created` is written **before the body is sent** and the response is refused (`500`, nothing leaves the server) if the entry cannot be written: no export without a trace. Params: `{report, format:"csv", rows, language, filters}` where `filters` keeps ids, dates, `direction`, `method`, `status` and only a boolean `hasSearch` — **the search text is not stored** (it may be a patient name; owner decision B2: audit never holds patient names). The acting user id is on the row as for every audit entry. A refused export (too large, 403) writes nothing. Catalog key `audit.export.created` in both languages.
- **Permissions:** the new permission `exports.run` (granted to `owner`; so a future accountant role can see a screen without being able to take its data out) on top of the data permission in the table. 401/403 test per endpoint, including "has `payments.read` but not `exports.run`".

### 2.2 Columns
Headers shown in `ar` / `en`. "Remaining", "Balance" etc. are signed integers rendered as in the Money rule.

**Debts** (one row per doctor with a balance, in the screen's order — absolute amount desc, then name):
`الطبيب / Doctor` · `الاتجاه / Direction` (مستحق لي / Owed to lab, مستحق عليّ / Owed by lab) · `المبلغ / Amount` (absolute) · `الرصيد / Balance` (signed, positive = owed to the lab) · `شيكات قيد التحصيل / Pending cheques`. No totals row (it would break sorting and pivoting; the four summary figures are on the screen).

**Debt breakdown of one doctor** — a flat table whose `Remaining` column **sums to the balance** (open it in Excel, select the column, the status bar shows the balance):
`النوع / Type` (رصيد افتتاحي / Opening balance · حالة / Case · رصيد دائن / Credit) · `رقم الحالة / Case no.` · `المريض / Patient` · `تاريخ الاستلام / Received` · `الحالة / Status` · `الإجمالي / Total` · `المدفوع / Paid` · `المتبقي / Remaining`. The opening row has only `Remaining` (= `openingRemaining`), the credit row has `Remaining` = `−credit`. Case rows are the open cases only (same as the modal).

**Doctor statement** — first row is the period opening (`Type` = رصيد افتتاحي للفترة / Opening for period, `Balance` = `periodOpening`); then one row per line:
`التاريخ / Date` · `النوع / Type` (حالة / Case, دفعة / Payment, شيك مرتجع / Returned cheque) · `المرجع / Reference` (case no. or `IN-000012`) · `البيان / Description` (patient name; or method + cheque no. + bank) · `مدين / Debit` · `دائن / Credit` · `الرصيد / Balance` (running). The last row's balance is the closing balance.

**Payments** (filtered set; voided rows included, marked): `رقم السند / Voucher` · `تاريخ الدفعة / Payment date` · `تاريخ التحصيل / Cleared / effective date` (cash, transfer: payment date; cheque: the day it cleared, empty while pending) · `الطبيب / Doctor` · `الطريقة / Method` · `رقم الشيك / Cheque no.` · `البنك / Bank` · `تاريخ الاستحقاق / Due date` · `رقم الحالة / Case no.` · `المبلغ / Amount` · `الحالة / Status` (فعالة / Active, ملغاة / Void) · `محتسبة / Counted` (نعم / لا) · `حالة الشيك / Cheque status` · `سبب الإلغاء / Void reason` · `ملاحظات / Notes`.

### 2.3 Doctor statement improvements (additive, no behaviour change)
The B3 statement (`GET /doctors/{id}/statement`) is correct (running balance over the whole history, paged on the server) but its lines are bare. Additive fields, existing ones unchanged, `contract:check` regenerates the client:
- case line: `patientName`, `caseNo` (number); payment line: `voucher` (`IN-000012`), `method`, `chequeNo`, `bank`, `boundCaseNo` (when bound); cheque-return line: same cheque fields.
- response: `totals: {debit, credit}` for the chosen range, so the screen and CSV show them without summing client-side.
- a **statement tie-out** (C above) is tested; if the B3 query turns out not to satisfy it for some history (for example a cheque cleared, returned, then voided), the fix is part of this slice and gets its own test.
Patient names on the statement need `cases.read` as well; without it the field is omitted (null) and the line shows the case number only.
Not in B4: print/PDF of the statement (B6 `كشف حساب`), statement language override.

## 3. Receipts and expenses reports — **Needs owner decision O1**

**What exists:** B3 built incoming payments only (`payments`, `IN-` vouchers). `GET /payments` already returns the table with `totals:{counted, pendingCheques}` and the web payments page already shows the report (SPEC §5.8 «تقرير المقبوضات»). **B3 did not build outgoing payments, expenses, `OUT-` vouchers, or refunds** (S10). SPEC §5.9/§10 put the expenses report on the outgoing-payment page, so it cannot be built honestly without that feature.

**Receipts report in B4 (all options):** a summary above the payments table and in the CSV: counted total, split by method (cash / transfer / cheque), number of payments, pending cheques (count + amount, memo), voided (count + amount), «آخر دفعة» (voucher, date, amount). `GET /payments/summary` with the same filters as `GET /payments`, permission `payments.read`, one grouped query. **Date basis:** the summary counts a payment on its *effective date* (cash/transfer: payment date; cheque: the day it cleared) so that "this month" equals Home's «المقبوض هذا الشهر» (test: summary of the current month = `GET /ledger/summary.receivedThisMonth`). The table below keeps filtering on voucher date as in B3; the page labels the summary «حسب تاريخ التحصيل» to make the difference explicit (O3).

| | (a) Minimal outgoing payments + expenses report inside B4 | (b) Receipts now, expenses report deferred **(recommended)** |
|---|---|---|
| What is built | `outgoing_payments` (or `payments.direction`) with `OUT-000001` vouchers, categories from `expense_categories` (already seeded in B1), payee text, cash/cheque/transfer, void with reason, cheque rows with direction; screen «إنشاء دفعة صادرة» with the report «تقرير المصاريف» (totals per category); sidebar item; Home card. Minimal = **expenses only** (non-doctor categories) with **no effect on doctor balances**. Doctor refunds (category «طبيب (استرداد)», `paid_out` in the §7.3 formula) stay out. | Receipts summary + CSV only. «دفعة صادرة» stays «قريباً» on Home. |
| Cost | About +35–45% of B4: one migration (table, counter `payment_out_no`, constraints, indexes, permissions), repository/service/DTOs, void, cheque register direction chip and filter (SPEC §5.13 «واردة/صادرة»), currency lock (`hasMoneyData` + `lockCurrencyForMoneyWrite`), idempotency, audit, ~25 API error cases and tests, one more form + report screen in both languages, e2e. |  ~0 extra. |
| Risk | Medium–high: it adds a second money write path and extends the currency-lock and cheque-register code that B3 just stabilised, inside a slice whose acceptance criterion is a read-side tie-out. If the owner later wants refunds, the model must be revisited (does a refund reduce credit or create debt on old cases? `allocate` has no `paid_out` yet), so a quick design here may be wrong. SPEC §5.13 says the register shows incoming **and** outgoing cheques, so expense cheques widen the cheque register scope too. | Low. The feature is not lost; it becomes its own slice (outgoing payments + refunds + expenses report + cheque direction) where `paid_out`, the refund rule and the register are designed together. Cost for the owner: no expenses report until that slice. |
| Needs SPEC edits | §10/§11 (B4 row) | §11 (B4 row: expenses report moved) |

**Recommended default: (b).** It keeps B4 a read-side slice whose invariant (tie-out) cannot be broken by new writes, and avoids designing refunds by accident. **Alternative if the owner needs expense tracking now:** (a) minimal, expenses-only, and I will add a short plan section (data model, lock order, cheque direction) for approval before stage 1 starts. Under (b) the expenses report is removed from the B4 row in SPEC §11, §10 and `docs/production-readiness.md` (new row), and Home keeps «قريباً» on «دفعة صادرة».

## 4. Paid / remaining in the cases list and balance in the doctors list

### 4.1 Cases list — `paid` and `remaining` per row
Items of `GET /cases` gain `paid` and `remaining` (additive). They are `null` for a caller without `ledger.read`. For a cancelled case: `paid 0`, `remaining 0` (same as `GET /cases/{id}`).

**Efficient way (no N+1, no allocation per row):** the FIFO needs a doctor's whole history, so per row is wrong; per **doctor on the page** is right. After the page query returns (≤ 100 rows, default 25):
1. `ids` = distinct `doctor_id` of the page (≤ 25 in practice, ≤ 100 at most).
2. **One** statement for all their cases: `SELECT doctor_id, id, case_no, received_date, total, status FROM cases WHERE doctor_id = ANY($ids)` (uses `cases_doctor_received_ix`).
3. **One** statement for their counted payments, **aggregated in SQL**: `SELECT doctor_id, case_id, SUM(amount) FROM payments LEFT JOIN cheques … WHERE doctor_id = ANY($ids) AND <countedWhere> GROUP BY doctor_id, case_id` — at most one row per bound case plus one unbound row per doctor, so 50 000 payments never travel to Node.
4. **One** statement for the doctors' opening balances (can be joined into 2).
5. `allocate()` runs in Node **once per doctor** over those rows (pure function, unchanged — the single source of truth) and fills `paid`/`remaining` for the page's cases.
Total: the existing list + count statements + 3 → **a fixed number of statements, independent of page size**. `LedgerRepository.doctorInput` becomes `doctorInputs(ids[])` (the single-doctor path calls it with one id, so the case page, balance, breakdown and list all use the same input builder).
**Rejected alternative:** a SQL window-function twin of `allocate` (clamped cumulative sums). Fastest, but a second implementation of the rule that already needed a matrix test for `isCounted`; revisit only if the target below is missed.

**Performance target:** at 20 000 cases / 50 000 payments / 500 doctors, a page of 25 with the worst page shape (25 different doctors) **p95 ≤ 150 ms server time**, and the pathological doctor (5 000 cases, 10 000 payments) ≤ 100 ms for his own page. The existing target (SPEC §6: smooth at that scale) is the reason; the targets are for this machine class and are *reported* from the test, while the test's **assertions** are deterministic ones (below), not wall-clock, so CI cannot flake.

**Test with a large dataset** (`test/integration/ledger-scale.spec.ts`, Testcontainers): `test/support/large-dataset.ts` inserts through SQL `generate_series` (not the API, for speed): 500 doctors, 20 000 cases (random statuses, ~3% cancelled), 50 000 payments (60% bound, cheques in every state, 2% void), ~8 s. Assertions: (1) a **statement counter** (Drizzle logger hook) shows the same number of statements for `pageSize` 5, 25 and 100; (2) for 30 sampled doctors the paid/remaining of every row equals `allocate()` run on that doctor alone; (3) `Σ remaining + openingRemaining − credit = balance` for the doctors on the page; (4) `EXPLAIN (ANALYZE, BUFFERS)` of steps 2–3 uses the `cases_doctor_received_ix` / `payments_doctor…` indexes (no seq scan on `payments`); (5) the elapsed time of 20 repetitions is logged as p50/p95 for the stage report (and asserted ≤ 1 000 ms p95 as a gross-regression guard only).

### 4.2 Doctors list — balance column
Items of `GET /doctors` gain `balance` and `direction` (null without `ledger.read`). One extra statement for the page: the existing `balancesCte` made **restrictable** (`balancesCte(ids)` filters `cases`, `payments` and `doctors` by `doctor_id = ANY($ids)` inside the CTEs so the other 480 doctors are not aggregated). No allocation needed. No sort/filter by balance now (O8; the debts screen is the place for that). Tests: the column equals `GET /doctors/{id}/balance` for every doctor of the demo and of the large dataset; the number of statements does not grow with page size.

Both additions are covered by the tie-out of §1.4 (the SQL CTE, `doctorBalance` and `allocate` must agree).

## 5. Global search

### 5.1 What is searched
`GET /search?q=` (permission `search.use`; each group also needs its own permission and is omitted without it):
| Group | Permission | Matches | Shows | Click |
|---|---|---|---|---|
| Doctors | `doctors.read` | name, clinic, phone (contains) | name, clinic, active flag | doctor page |
| Cases | `cases.read` | case number (exact, if `q` is digits), patient name (contains) | case no., patient, doctor, status, received date | case details |
| Payments | `payments.read` | voucher (`IN-000012`, `in12`, `12`), cheque number (contains) | voucher, doctor, method, amount, date, void flag | payments list filtered to it (`/payments?q=IN-000012`) |
"Patients" are the patient-name matches inside the Cases group (there is no patient record, SPEC §12.1, so a patient has no page to open) (P2, O6). Doctor name is **not** a payment match (it is already in the Doctors group; the payments list search keeps it).
- Limit 5 per group (`limit` ≤ 10); each group header has «عرض الكل (N)» linking to the full list with `?q=` (cases list, doctors list, payments list all already read `q`). Counts per group are exact (one `count` per group, capped at 99+ for the label).
- Ranking: exact case/voucher number first, then names starting with the text, then contains; ties by recency (cases, payments) or name (doctors). Deterministic `ORDER BY` with `id` last.
- **Arabic matching:** both the query and the column are folded for comparison only (never stored): strip tashkeel and tatweel, أ إ آ → ا, ى → ي, ة → ه, lower-case Latin, collapse spaces (NFC first, like `normalizeName`). Done in SQL with one immutable `translate()` expression and the same function in TS for the query; the stored value is untouched (owner rule B1: no letter folding for *uniqueness*; this is for *finding*). Test table: «أحمد» finds «احمد» and «أحمد»; «مها» finds «مهى/مها»; «فاطمة» finds «فاطمه».
- **Closest matches** (SPEC §5.17): if a group has no contains-match, retry with word-by-word matching (each word of `q` of ≥ 2 characters must be contained, any order, so «علي محمد» finds «محمد علي الخطيب»), then with any-word matching ranked by words matched, and mark the group `closest: true` so the UI says «أقرب النتائج». No typo tolerance without pg_trgm (O4).
- Safe by construction: `LIKE` wildcards escaped (`containsPattern`), parameters only, `q` trimmed, NFC, 1–100 characters (else 400); the client sends ≥ 2 characters (or ≥ 1 digit). Not logged at INFO (it may be a patient name); no audit entry (a read, like every list).

### 5.2 UI (cmdk is already a dependency; `entity-picker.tsx` uses it)
- A search button in the top bar (SPEC §4: «ابحث عن طبيب أو حالة...») opens a **command dialog**; shortcut **Ctrl+K / ⌘K** (and `/` when focus is not in a field). The shortcut is shown on the button, in both languages.
- Server-side filtering (`shouldFilter={false}`), debounce **150 ms** (SPEC §5.17), in-flight request cancelled by TanStack Query when the text changes; no request while an **IME composition** is active (Arabic/CJK keyboards) and none under the minimum length (a hint line explains instead).
- Groups with headings and counts; ↑/↓ moves across groups, Enter opens, Ctrl+Enter opens in the list view (all results), Esc closes and **returns focus to the button**; the dialog is a modal with a focus trap and `aria-label`; the list is a `listbox` with a polite live region «٥ نتائج» / «5 results» (announced after the debounce, not per keystroke); the `<input>` has a visible label (visually hidden but present) and `aria-expanded`/`aria-activedescendant` from cmdk. Names use `dir="auto"` so a Latin name inside an Arabic row keeps its order; digits Western; highlight is bold + underline (not colour only); logical CSS only; mobile width: full-screen sheet.
- States: **idle** (hint + the three most recent doctors/cases from local state, none stored server-side), **loading** (skeleton rows, no layout jump), **empty** («لا توجد نتائج لـ "…"» with a link to the cases list search), **closest** badge, **error** (message + «إعادة المحاولة», `role="alert"`), **partial** (a group the user cannot read is simply absent).

### 5.3 pg_trgm — decision for production-readiness #15 (**O4**)
**Facts:** search today is `ILIKE '%…%'` (sequential scan) on `doctors.name/clinic/phone` and `cases.patient_name`; case numbers and voucher numbers are unique-indexed. At the SPEC target (20 000 cases, a few hundred doctors, 50 000 payments) a sequential scan of 20 000 short strings is in the low tens of milliseconds, inside the 150 ms budget; the portable PostgreSQL (EDB zip, ADR-0011) must also contain `pg_trgm` and the migration role must be allowed to `CREATE EXTENSION` (pg_trgm is a *trusted* extension on PG 13+, so the DB owner may) — both **unverified** here, and an installer risk; Arabic text under the installer's collation also needs checking (pg_trgm splits words by the locale's idea of "alphanumeric").
**Recommended default: no `pg_trgm` and no new index in B4.** Search works with folded `ILIKE` and the word fallbacks above. Stage 0 measures it on the large dataset (§4.1): `GET /search` p95 for 20 000 cases / 500 doctors / 50 000 payments.
- **Gate:** if p95 > 100 ms, or the owner wants typo tolerance («أحمد» vs «احمذ»), switch to the migration below in the same branch. The decision and the measured numbers go into production-readiness #15 either way.
- **Migration outline if "yes"** (`0006_search_trgm.sql`, hand-written, forward-only, tested on empty DB and on 0005 + the large dataset): `CREATE EXTENSION IF NOT EXISTS pg_trgm;` · `CREATE FUNCTION search_fold(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE …` (the `translate()` expression) · `CREATE INDEX CONCURRENTLY`-style is not available inside the migrator's transaction, so plain `CREATE INDEX` on `cases (search_fold(patient_name) gin_trgm_ops)`, `doctors (search_fold(name) gin_trgm_ops)` and `doctors (search_fold(clinic) gin_trgm_ops)` (small tables at v1 scale, so the lock is short) · the search query adds `% / word_similarity()` ranking for the "closest" tier. Installer note: the upgrade `pg_dump` + rollback already covers it; a missing extension makes the migration fail cleanly (rollback), reported by the installer check in B7. Tests: extension present, the function is immutable, `EXPLAIN` shows the index for a 3+ character contains-query, results equal the non-trigram path on the dataset.

## 6. API, screens and states

### 6.1 API (all under `/api/v1`, Bearer token, DTO-validated, error envelope with stable `code`, ar/en messages)
| # | Method + path | Permission | Request | Response | Errors (beyond 400 / 401 / 403) |
|---|---|---|---|---|---|
| 1 | `GET /doctors/{id}/debt-breakdown` | `ledger.read` + `cases.read` | `?page&pageSize` (open cases) | `{doctor:{id,name,active}, figures:{opening, charges, received, pendingCheques, balance, direction}, openingRemaining, credit, openCases:{count, remaining, page:Page<{id,caseNo,patientName,receivedDate,status,total,paid,remaining}>}, tieOut:{openingRemaining, casesRemaining, credit, balance}, latestPayments:[{id,voucherNo,paidAt,method,amount,counted,boundCaseNo}]}` | 404 doctor; 500 `error.internal` if the tie-out fails (logged) |
| 2 | `GET /doctors/{id}/statement` (extended, §2.3) | `ledger.read` | unchanged | existing + line fields + `totals` | 404 |
| 3 | `GET /payments/summary` | `payments.read` | same filters as `GET /payments` | `{counted:{amount,count,byMethod:{cash,transfer,cheque}}, pendingCheques:{count,amount}, voided:{count,amount}, last:{voucherNo,paidAt,amount}\|null, basis:"effective"}` | — |
| 4 | `GET /cases` (additive) | `cases.read` (+ `ledger.read` for the figures) | unchanged | items gain `paid`, `remaining` (null without `ledger.read`) | — |
| 5 | `GET /doctors` (additive) | `doctors.read` (+ `ledger.read`) | unchanged | items gain `balance`, `direction` (null without `ledger.read`) | — |
| 6 | `GET /exports/debts` | `ledger.read` + `exports.run` | filters (§2.1), `lang?` | `text/csv` (BOM) | 422 `export.too_large`; 429 |
| 7 | `GET /exports/doctors/{id}/debt-breakdown` | `ledger.read` + `cases.read` + `exports.run` | `lang?` | `text/csv` | 404; 422 `export.too_large`; 429 |
| 8 | `GET /exports/doctors/{id}/statement` | `ledger.read` + `exports.run` | `from?&to?&lang?` | `text/csv` | 404; 422; 429 |
| 9 | `GET /exports/payments` | `payments.read` + `exports.run` | filters, `lang?` | `text/csv` | 422; 429 |
| 10 | `GET /search` | `search.use` (+ per group) | `?q&limit` | `{q, groups:{doctors?:{items,total,closest}, cases?:{…}, payments?:{…}}}` | 400 `q` empty or > 100 |
New catalog keys (ar + en): `error.export.too_large`, `csv.*` headers, `audit.export.created`, `search.*`, `debts.breakdown.*`. OpenAPI documented, `openapi:export` + `api:generate` committed, `contract:check` clean. New permissions `exports.run`, `search.use` (granted to `owner`) come from the hand-written **migration `0005_exports_search_permissions.sql`** (no tables; same pattern as the permission block of 0004; tests: empty DB → 0005 and 0004+data → 0005 with the permissions granted). Routes without a permission stay denied.

### 6.2 Frontend (stage 2; skills `smile-artec-web-*`, `frontend-design` for the modal and the search dialog)
**Routes / state in the URL (`useUrlState`, like B3):**
- `/debts?q&dir&page&doctor=<id>&bp=<page>` — `doctor` opens the breakdown modal (so a link, reload and the browser Back button work; Back closes it). Row click opens the modal; the modal has «كشف الحساب» (statement page) and «تصدير CSV» actions.
- `/doctors/:id/statement?from&to&page` — gains «تصدير CSV» (keeps the range) and the new description column.
- `/payments` — summary strip under the form (counted, by method, pending cheques, voided, «آخر دفعة»), «تصدير CSV» with the current filters.
- `/cases` — two new columns «المدفوع» and «المتبقي» (money columns; hidden when the API returns null; no new filter).
- `/doctors` — column «الرصيد» with the direction badge.
- Global search — a dialog available from every page (not a route); the «show all» links land on `/cases?q=`, `/doctors?q=`, `/payments?q=`.
- No expenses screen (O1 = b).

**Components:** `DebtBreakdownDialog` (header figures, equation footer, open-cases table with its own pager, latest payments), `ExportButton` (fetches the CSV with the Bearer token as a blob through the generated client — a plain link cannot send the token — takes the file name from `Content-Disposition`, saves via an object URL that is revoked, shows «جارٍ التصدير…», maps `422 export.too_large` to its message, hidden without `exports.run`, disabled with a reason when the filtered set is empty), `ReceiptsSummary`, `GlobalSearch` (cmdk), `BalanceBadge` (reused from B3). Money cells use the existing `Money`/`Th/Td` column kinds.

**States (every new view):** loading skeleton (no layout shift), empty (breakdown: «لا توجد مبالغ مستحقة على هذا الطبيب» with the credit line if any; summary with no payments: zeros and «لا توجد دفعات في هذه الفترة»), error (inline message + retry; route boundary for page failures), disabled-with-reason for exports, 403 shown as the standard "no permission" message. Every string in `ar.json` and `en.json` (plural forms for counts), logical CSS only, one `h1` per page, labelled dialogs, focus returns to the trigger, status never by colour alone.

## 7. Test plan

**Unit (Jest/Vitest):**
- `CsvWriter`: BOM present once; CRLF; quoting of `,` `"` CR LF; empty set → header only; Arabic and emoji round-trip; injection neutralisation table (text vs numeric cells); very long cell; delimiter constant.
- Money text: 0/2/3 decimals × {0, 1, 5, 99, 100, 12345, −5000, MAX} against a table, plus a property test `parse(format(x)) = x` using `packages/shared` and **no float anywhere** (a lint-style test greps the export module for `toFixed`, `parseFloat`, `/ 100`).
- `fold()` (Arabic table, Latin case, idempotence) and the TS twin of the SQL expression; voucher/number detection regex; ranking comparator.
- Breakdown assembler: `tieOut` equals the equation for E1–E5; credit split; open-case filter; paging totals independent of the page.
- `doctorInputs` batch builder equals the single-doctor builder.
**Integration (Testcontainers PostgreSQL 16):** migration 0005 on empty and on 0004 + data; `balancesCte(ids)` equals the unrestricted CTE for those ids; the **tie-out** over the large dataset and over random ledgers (§1.4); statement closing = balance for every doctor of the dataset; `ledger-scale.spec.ts` (§4.1); export snapshot consistency (a payment inserted by a second connection mid-export does not appear, rows and totals agree); `EXPLAIN` checks for breakdown, list batch, search and receipts summary; search ranking and fold on the dataset; (only if O4 = yes) trigram migration tests.
**API e2e (Supertest):** 401/403 per endpoint including "`payments.read` without `exports.run`" and "`ledger.read` without `cases.read` on the breakdown"; unknown query keys rejected; error codes in ar and en; `GET /doctors/{id}/debt-breakdown` for E1–E5 built through the API with hand-calculated numbers; **every-demo-doctor tie-out** (§1.4); CSV: status, headers (`Content-Type`, `Content-Disposition`, `Cache-Control`), BOM bytes, header row in ar and en, row count equals the list's `total` for the same filters, money text, `Remaining` column sum = balance, `too_large` with a temporarily lowered cap, audit row written with user id and **without** search text or patient names, no audit row on 403/422; search: groups by permission, limits, `closest`, voucher forms (`IN-000012`, `in12`, `12`), wildcard characters, folded Arabic, 400 on empty/too long; `GET /cases` and `GET /doctors` new fields null without `ledger.read`; receipts summary month = `ledger/summary.receivedThisMonth`; run with `TZ=UTC` and a non-UTC lab zone (identical files).
**Web unit/component (Vitest):** breakdown dialog states (loading, error, empty, credit-only, paged), URL state for `doctor`/`bp` (open, reload, Back), `ExportButton` (blob download, filename, too-large message, disabled reason, hidden without permission), search (debounce 150 ms with fake timers, IME composition suppressed, min length, cancel on new text, keyboard map, live-region text, groups absent without permission), money alignment per column kind, i18n parity and RTL guards, new columns hidden when the API sends null.
**E2E Playwright + axe (`TZ=UTC`, ar and en, `demo` project with exact data):**
- Debts → open the breakdown for each demo doctor with a balance: the modal's equation equals the doctor page balance and the debts row; credit doctor shows the credit line; Back closes the modal; filters round-trip through the URL.
- CSV: click «تصدير CSV» on debts, breakdown, statement, payments; read the downloaded file in the test: first 3 bytes `EF BB BF`, Arabic header text, row count = screen total, `Remaining` sum = balance, a name starting with `=` is neutralised (created through the API in the test).
- Cases list shows paid/remaining equal to the case page for 5 sampled rows; doctors list balance equals the doctor page.
- Search: Ctrl+K opens, type an Arabic name with a different hamza, groups render, Enter opens the doctor, Esc returns focus to the button, voucher search lands on the payments list; closest-match badge; no-permission group absent (owner has all, so covered at component level).
- `expectAccessible` (axe) with the dialog open and on every changed page; layout checks (no sideways scroll, text edges in the modal, the new columns at 1280 px and 390 px).
- Screenshots of the modal, summary, search dialog in both languages for the PR.
**Contract drift:** `npm run contract:check`.
**Demo seed additions (`scripts/demo`, API only; `demo-seed.spec.ts` and `home-demo.spec.ts` expected counts updated in the same commit):** a doctor with a **negative opening balance** and one case (E4); a doctor with **many open cases** (≈ 30, so the breakdown pager and the export have more than one page); a doctor whose payments are all bound to a **cancelled** case (credit shown); an **overpaying** doctor stays (E3); Arabic names that differ only by hamza/ta marbuta/tashkeel for the search fold test; no hostile strings in the demo (they live in tests).
**Commands run and reported at each gate:** lint, typecheck, i18n:check, rtl:check, unit, integration, API e2e, web tests, build, contract:check, test:e2e:web (needs `E2E_DATABASE_URL` to a throwaway `*_e2e` container; never the development database).

## 8. Backend / frontend split, order and gates (one branch)

**Stage 0 — spikes, no product code (≈ half a day):** (1) `large-dataset.ts` generator and the baseline timings of today's list, balance, search; (2) check that the demo seeder can run in Jest against the test app; (3) open a sample UTF-8-BOM CSV in the owner's Excel (comma vs semicolon, Arabic header, `=` cell); (4) only if O4 is being reconsidered: `CREATE EXTENSION pg_trgm` against the installer's PostgreSQL build and Arabic trigram behaviour. Output: numbers pasted into this plan's status section.

**Stage 1 — backend (commits in this order, one logical change each):**
1. `doctorInputs(ids[])`, `balancesCte(ids)` refactor with the existing B3 tests unchanged (green before anything new).
2. Debt breakdown endpoint + tie-out assertion + E1–E5 + property test + demo-doctor tie-out test.
3. Statement additive fields + statement tie-out test.
4. `paid/remaining` in the cases list, `balance` in the doctors list + `ledger-scale.spec.ts`.
5. Receipts summary.
6. Migration 0005 (permissions) + `CsvWriter` + the four exports + audit + limits.
7. Search endpoint (+ trigram migration 0006 only if O4 = yes).
8. OpenAPI export, generated client, catalogs (ar/en), demo seed additions, docs.
**Gate 1 (all green and reported with real output):** lint, typecheck, i18n:check, unit, integration, API e2e, build, contract:check. If red → fix before stage 2.

**Stage 2 — web:** breakdown modal + debts URL state; `ExportButton` on the four screens; receipts summary; new columns in cases and doctors lists; global search; catalogs; component tests; Playwright + axe + screenshots.
**Gate 2:** everything of Gate 1 plus web tests, rtl:check, `test:e2e:web` (both languages, `TZ=UTC`).
Docs updated in the last commit: SPEC §10/§11 (expenses report moved, if O1 = b), `docs/production-readiness.md` (S11, S12 done; #15 decision with numbers; S10 stays; new rows: export row cap, Excel delimiter, search folding), the skills `money-ledger` (breakdown + batch input) and `web-feature-workflow` if a pattern is new, this plan's "decisions taken while unattended" section. No push; the PR is opened only after the owner's go-ahead.

## 9. Risks

1. **Tie-out holds only if `allocate`, `balancesCte` and the statement query stay in step** — mitigated by the three-way test over demo, random and large data, the runtime assertion, and the mutation check.
2. **Batch allocation changes `doctorInput` used by money writes** (cancel audit, case page) — refactor first with the B3 suite unchanged and green; the single-doctor path is the batch path with one id.
3. **CSV opens wrongly in Excel** (delimiter by regional settings, BOM ignored by some tools) — stage-0 check on the owner's machine; one constant to flip; BOM tested at the byte level.
4. **CSV/formula injection** from doctor, patient or note text — neutralisation of text cells only, tested; numeric cells never from user text.
5. **Data leaves the system** (patient names in the breakdown/statement/payments files) — `exports.run`, `cases.read` for patient columns, an audit entry for every export (fail-closed), rate limit, row cap; the search text is never stored in the audit entry.
6. **Export memory/time** — 50 000-row cap, keyset batches, one snapshot; the cap is a constant that can be raised after the B8 load test.
7. **Search reveals patient names to any `cases.read` user** — same as the cases list today (production-readiness #19), group permissions applied; revisit when more roles exist.
8. **Arabic folding surprises** (a user expects «ة» ≠ «ه») — folding applies to finding only, never to stored data or uniqueness; table-driven tests; easy to disable with one function.
9. **pg_trgm is an installer dependency** — avoided by default; if adopted, a failed `CREATE EXTENSION` rolls the upgrade back cleanly.
10. **Scope creep into outgoing payments** — option (a) is isolated behind O1 and needs its own approved addendum before any code.
11. **Receipts basis confusion** (voucher date vs clearing date) — labelled on screen, tested against Home's figure.
12. **Large-dataset test time in CI** — ~8 s data load; assertions are structural (statement counts, equality with `allocate`, `EXPLAIN`), not wall-clock.

## 10. Needs owner decision (each has a default; I implement the default if you approve the plan without comment)

| # | Question | Default (recommended) | Alternative |
|---|---|---|---|
| **O1** | **Expenses report.** B3 built no outgoing payments/expenses. | **(b)** receipts report now (summary + CSV); expenses report and outgoing payments move to their own slice; Home keeps «قريباً» on «دفعة صادرة». SPEC §10/§11 updated. | **(a)** minimal outgoing payments (expenses only, no doctor refunds, no balance effect) + expenses report inside B4, ≈ +40% work; I write an addendum for approval first. |
| O2 | CSV delimiter. | Comma; verified on your Excel in stage 0 and switched to `;` if it opens in one column. | `;` from the start. |
| O3 | Receipts summary date basis. | Effective date (cash: payment date, cheque: the day it cleared), labelled on screen; equals Home's «this month». | Voucher date (cheques counted on their payment date although they do not count yet). |
| **O4** | **pg_trgm / search indexes** (production-readiness #15). | **No extension and no index now**; folded `ILIKE` + word fallbacks; measured in stage 0; adopt the 0006 migration only if p95 > 100 ms or you want typo tolerance. | Adopt pg_trgm now (typo-tolerant "closest matches"; installer must ship the extension). |
| O5 | Search folds Arabic letter variants (أ إ آ ا, ى ي, ة ه, tashkeel) for finding. | Yes (finding only; stored names untouched). | Exact letters only. |
| O6 | "Patients" in global search. | Patient-name matches appear in the Cases group (no patient record exists). | A separate "patients" group of distinct names (opens the cases list filtered by that name). |
| O7 | Who may see the breakdown and export patient names. | Breakdown, its CSV and the statement's patient column need `cases.read` as well; every export needs the new `exports.run` and is audited (without the search text). | `ledger.read` only; no separate export permission. |
| O8 | Doctors list: balance column. | Show balance + direction (needs `ledger.read`); no sort/filter by balance (use «الديون»). | Also sort and filter by balance. |
| O9 | Export size limit. | 50 000 rows per file, otherwise ask to narrow the filters. | Higher cap with background generation (not needed at SPEC scale). |
| O10 | Export language. | The language of the screen at export time (headers and labels); typed data as typed. | Always Arabic, or a language choice in the export dialog. |
| O11 | Breakdown scope. | Unpaid and partly paid cases + opening + credit; fully paid cases are not listed (the statement shows them). | List every case with its paid status. |

Credits still cannot be refunded in the app (S10) until the outgoing-payments slice, whichever way O1 goes.
