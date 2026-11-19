# B4b — Outgoing payments, refunds and the expenses report (plan)

Status: **approved by the owner (defaults X1–X11, 2026-11-19) with three conditions — isolation tests in both directions and a database "exactly one owner" CHECK on cheques; the B4 tie-out tests extended with refunds including a refund followed by a bounce; SPEC and production-readiness updated in this branch. Stage 1 (backend) and stage 2 (screens) built on this branch; waiting for the owner's go-ahead before any push or PR.** The last sections record what was measured and the choices made while building (stage 1, then stage 2). Moved out of B3 (owner scope, `docs/plans/b3-payments.md` S4) and out of B4 (owner decision O1 = option (b), `docs/plans/b4-debts-reports-search.md` §3, confirmed 2026-11-16). The roadmap entry written in B4 is kept below (scope, dependencies, open questions). The full plan follows it and answers each open question.
Branch: `feat/b4b-outgoing-expenses` (from `main` after PR #12, B4).
Sources read (2026-11-19, against `main` at `abe44b3`): SPEC §3, §4, §5.1/5.9/5.10/5.11/5.13, §6.1, §7, §8, §10, §11, §12; CLAUDE.md; ENGINEERING_STANDARDS §5–§6; `docs/production-readiness.md` (#14, S7, S8, S10, S15, S16, S18); `docs/plans/b3-payments.md`; `docs/plans/b4-debts-reports-search.md`; skills feature-workflow, money-ledger, db-migrations, security-review, `smile-artec-web-*`. Code read: `shared/db/schema/{payments,catalog}.ts`, `migrations/0004_payments.sql`, `payment-rules.ts` (`allocate`, `breakdown`, `doctorBalance`, `formatVoucher`), `ledger.repository.ts` (`balancesCte`, `doctorInputs`, `statement`, `summary`), `payments.repository.ts` (`countedWhere`, `chequeDuplicate`, `listCheques`, `chequeSummary`), `cheques.service.ts`, `expense-categories.service.ts`, `delete-or-deactivate.ts`, `currency-guard.ts`, `SettingsRepository.hasMoneyData`, `exports.service.ts`, `search.service.ts`, the web `ActionCards`, `ShellLayout`, `features/payments`, the demo seed.

## Roadmap entry (from B4, kept)

### Why it is its own slice
The expenses report of SPEC §5.9/§10 needs something to report: outgoing payments. B3 built incoming payments only, and B4 is a read-side slice whose acceptance criterion (the breakdown ties out to the ledger) must not be put at risk by a second money write path. Outgoing payments touch the balance formula, the allocation rule, the currency lock and the cheque register, so they are designed together.

### Scope (from SPEC)
- **«إنشاء دفعة صادرة» (§5.9):** category from `expense_categories` (seeded in B1, including the system category «طبيب (استرداد)»), payee text (required except for the doctor category), doctor picker for refunds, amount, method cash / cheque (+ transfer, as for incoming, D1 of B3), date, note; success «✅ تم حفظ المصروف».
- **«تقرير المصاريف» (§5.9, §10):** date and category filters, totals per category, CSV (UTF-8 with BOM) through the B4 `CsvTable`/`ExportsService`, audited, under `exports.run`.
- **Vouchers:** `OUT-000001`, gap-free, same transaction rules as `IN-` (§7.7); idempotency key; optimistic concurrency; void with reason, never delete (§5.10, §7.6).
- **Cheques:** outgoing cheques counted as an expense **only when cleared** (§7.4); the register gets the direction chips «واردة / صادرة» (§5.13) and its filters/summary count both directions.
- **Refunds to doctors (category «طبيب (استرداد)»):** money returned to a doctor increases what the lab owes him: `paid_out` in `balance = charges − received + paid_out` (§7.3). This closes production-readiness S10 (a credit can finally be refunded).
- **Home:** the «دفعة صادرة» card becomes a link with a figure; «الأرقام الرئيسية» gains expenses.

### Dependencies on what exists
- **B3:** `payments`/`cheques` tables and rules (`isCounted`, cheque transitions), `lockCurrencyForMoneyWrite`, `hasMoneyData` (must also look at outgoing payments), counters, idempotency, audit, the payments and cheque screens.
- **B4:** `doctorInputs`, `balancesCte`, `breakdown()` and the three-way tie-out test. **A refund changes all three** (`balancesCte`, `doctorBalance`, `allocate`/`breakdown`) and the tie-out test must keep passing with refunds in the data.
- **B4 CSV module** (`shared/csv`, `ExportsService`) for the expenses export; **B4 receipts summary** as the model for the expenses totals.

### Open design questions → where this plan answers them
| # | Question | Answer (default, owner to confirm) | Section |
|---|---|---|---|
| 1 | Refund larger than the credit | Refused when it is created; if the credit shrinks **later** (a cheque bounces, a payment is voided), the part no longer covered shows as debt on the refund's own line. | §2.3, X2 |
| 2 | Separate table or `direction` on `payments` | Separate `outgoing_payments` table; the `cheques` table is shared, with a second owner column. | §1, X1 |
| 3 | Expenses with no doctor touch no balance | Confirmed: they feed the expenses report, the cash summary and Home only. | §2.1 |
| 4 | Cash summary (SPEC §10) | Built here: `GET /ledger/cash-flow` and a panel on the outgoing page. | §4.3, X7 |
| 5 | Categories in use | Delete of a used category becomes deactivate (the existing B1 rule, now triggered by the new FK); the refund category stays undeletable and always active. | §1.4, X8 |

### Not in this slice
Staff, advances, supplier invoices and stock (SPEC §3.2). Payments to technicians are not a ledger: SPEC §7.2 says technicians are a lookup list with no accounting, so a salary is an expense in the «رواتب» category with the payee typed as text (X9). Invoices stay B6; printing a payment voucher stays B6 (same as receipts). Notifications for outgoing cheques due belong to B5's feed (the data is ready after this slice).

---

## 0. Where this plan departs from SPEC

| # | SPEC says | This plan does | Why |
|---|---|---|---|
| P1 | §8: one `payments` table with `direction in ('in','out')` | a separate `outgoing_payments` table; `cheques` gets a second owner column | About 40 query sites (payments, ledger, cases, doctors, exports, search, settings) read `payments` as "incoming money from a doctor". A shared table would need a `direction` filter in each; one missed filter counts an expense as money received from a doctor. A separate table leaves every B3/B4 query correct as it is (§1.1). |
| P2 | §7.3: `paid_out` is in the balance formula; `allocate` is FIFO over cases only | a counted refund is a **dated charge item** in the FIFO, like the positive opening balance (B3 D4) | Without that, `Σ remaining + openingRemaining − credit` cannot equal the balance once a refund exists (§2.3, proof). |
| P3 | §5.9: method cash / cheque | cash / cheque / transfer | Same as incoming (B3 D1). |
| P4 | §5.10: a separate «إلغاء دفعة» page for in and out | void stays a row action, now on both payment pages | Same as B3 D6; the owner can still ask for the page (X6). |
| P5 | §10: cash summary "Home card tooltip or Settings" | a panel on the outgoing page for the chosen period | The period filter already exists there; a tooltip cannot take a period. |

SPEC edits after approval: §5.9 (transfer, refund limit, payee rules), §5.13 (direction column), §7.3 (refunds in the FIFO), §8 (P1 note), §10 (P5), §11 B4b row.

## 1. Data model and migration outline (`0007_outgoing_payments.sql`)

### 1.1 Two options compared (X1)

| | (A) `direction` column on `payments` | (B) separate `outgoing_payments` table, shared `cheques` **(recommended)** |
|---|---|---|
| Existing queries | All ~40 query sites (`balancesCte`, `doctorInputs`, `statement`, `summary`, `receiptsSummary`, `list`, `latestPayments`, `boundTotal`, `boundActiveTotal`, exports, search, cheques register, duplicate check, `casePayments`, …) need `direction = 'in'`. One missed filter is a silent ledger error. | No existing query changes meaning. Every incoming query reaches `cheques` **through** `payments.id` (inner or left join), so outgoing cheques never show up in them. |
| Constraints | `doctor_id` NOT NULL and `voucher_no` UNIQUE must be loosened (`doctor_id` null for expenses, uniqueness per direction), plus conditional CHECKs per direction. That is an expand/contract change on B3's main money table. | Each table gets its own strict constraints: incoming keeps `doctor_id NOT NULL`; outgoing has its own `category_id NOT NULL` and party rule. |
| Numbering | Two counters on one unique column → unique `(direction, voucher_no)`. | Its own counter `payment_out_no`, its own unique `voucher_no`. |
| Cheques | Unchanged. | `cheques.payment_id` becomes nullable, plus `outgoing_payment_id` and an "exactly one owner" CHECK. The register, the status change and the duplicate check learn the second owner. |
| Lists "in and out together" (void page, search) | One query. | A `UNION ALL` of two small queries (only where both are needed: search, cash flow). |
| Risk | High (rewrites the stable B3 ledger). | Low on the ledger; medium on the cheque register (one ALTER, three code paths, all tested). |

**Pick (B).** The tie-out from B4 depends on the incoming queries; (B) keeps them correct as written. The new paths (refunds in the balance) are added on purpose and are each covered by the tie-out test.

### 1.2 `outgoing_payments`
| column | type / rule |
|---|---|
| `id` | bigint identity PK |
| `voucher_no` | bigint NOT NULL, unique, `> 0`; shown as `OUT-000001` (formatted by the API) |
| `kind` | text NOT NULL CHECK in (`expense`, `doctor_refund`). Copied from `expense_categories.is_doctor` at creation. That flag is set only by first-run setup and never changes, so the ledger never needs to join categories. |
| `category_id` | bigint NOT NULL → `expense_categories` ON DELETE RESTRICT |
| `doctor_id` | bigint NULL → `doctors` ON DELETE RESTRICT |
| `payee` | text NULL, 1..100 |
| `method` | text NOT NULL CHECK in (`cash`, `cheque`, `transfer`) |
| `amount` | bigint NOT NULL CHECK `> 0 and ≤ MAX_AMOUNT_MINOR` |
| `currency_code` | text NOT NULL (snapshot, as in `payments`) |
| `paid_at` | date NOT NULL (lab-local, never in the future) |
| `notes` | text NULL ≤ 500 |
| `status`, `void_reason`, `voided_at`, `voided_by` | same as `payments`, same `void_ck` |
| `idempotency_key`, `request_hash` | uuid NULL (partial unique) + hash; both set or both null |
| `row_version`, `created_at/by`, `updated_at/by` | `aggregateColumns()` |

CHECK `outgoing_party_ck`: `(kind = 'doctor_refund') = (doctor_id IS NOT NULL) AND (kind = 'expense') = (payee IS NOT NULL)`. A refund names a doctor and no payee; an expense names a payee and no doctor.
The rule `kind` = the category's `is_doctor` crosses two tables, so a CHECK cannot hold it. The service enforces it inside the creating transaction. An integration test asserts that no row disagrees, and an API test asserts that `is_doctor` cannot be changed through any endpoint.
Indexes, each tied to a query: `(paid_at desc, id desc)` for the list and the month figures; `(category_id, paid_at desc)` for the category filter and the per-category summary; `(doctor_id, paid_at desc, id desc) WHERE doctor_id IS NOT NULL` for refunds in the balance, statement and breakdown; unique `voucher_no`; unique partial `idempotency_key`.

### 1.3 `cheques` (shared, B3 table)
- `ALTER COLUMN payment_id DROP NOT NULL`; `ADD COLUMN outgoing_payment_id bigint NULL REFERENCES outgoing_payments ON DELETE RESTRICT`.
- CHECK `cheques_owner_ck`: `(payment_id IS NULL) <> (outgoing_payment_id IS NULL)` (exactly one owner).
- Unique partial index `cheques_outgoing_payment_uq (outgoing_payment_id) WHERE outgoing_payment_id IS NOT NULL`. The existing `cheques_payment_uq` already allows several NULLs.
- Direction is derived (`outgoing_payment_id IS NOT NULL` → `out`), not stored. The register filters by status/due date first (existing index); direction has two values and needs no index.
- `cheque_status_history` is unchanged (it hangs off `cheques.id`).
- Every change is an expand step: no data rewrite, no drop. Existing rows keep `payment_id` set, so the CHECK holds for all of them (asserted by the migration test).

### 1.4 Reference data, other changes
- `INSERT INTO counters ('payment_out_no', 1, 1)` (not owner-settable, like `payment_in_no`).
- Permissions `expenses.read`, `expenses.write`, `expenses.void`, granted to `owner` (X10). Routes without one stay denied.
- `SettingsRepository.hasMoneyData` adds `OR EXISTS (SELECT 1 FROM outgoing_payments)` (production-readiness #14).
- Expense categories: no schema change. `deleteOrDeactivate` already turns a delete into a deactivate when a row references the category (FK 23503). With the new FK, a used category becomes inactive instead of deleted, with no code change. Inactive categories are hidden from the form picker but stay in reports and filters (X8).
- Drizzle schema in `shared/db/schema/payments.ts`. `db:generate --name outgoing_payments`, review the SQL, append the hand-written counter/permission block.
- Tests: empty DB → 0007; DB at 0006 with B4 demo data → 0007 (existing payments and cheques untouched, `cheques_owner_ck` valid, counter and permissions present). This follows `b4-permissions-migration.spec.ts`.

## 2. How outgoing money affects the ledger

### 2.1 Three kinds of outgoing money
| Kind | Example | Changes a doctor's balance? | Where it shows |
|---|---|---|---|
| **Expense** (any category with `is_doctor = false`) | rent, electricity, materials, salaries (typed payee) | **No** | expenses report, cash flow, Home «المصاريف» |
| **Refund to a doctor** (the «طبيب (استرداد)» category) | returning an overpayment | **Yes**: `+ paid_out` (the lab owes him less) | the same, plus the doctor's balance, statement, breakdown, debts |
| **Payment to a technician** | — | **Not in SPEC** (§7.2: no technician accounting). A salary is an *expense* with a typed payee. | as an expense |

"Counted" for outgoing money follows §7.4 exactly as for incoming: active, and either cash/transfer or a **cleared** cheque. Pending and returned outgoing cheques never count; void never counts. The same `isCounted()` and `countedWhere()` apply. `countedWhere` becomes a function of the owning table, and the B3 matrix test covers both tables.

### 2.2 Balance (SPEC §7.3, now complete)
```
charges   = opening + Σ non-cancelled case totals
received  = Σ counted incoming payments
paid_out  = Σ counted outgoing payments of kind doctor_refund for this doctor
balance   = charges − received + paid_out
```
`doctorBalance(opening, cases, counted, paidOut)`; `balancesCte` gains a `po` CTE (`kind = 'doctor_refund'`, counted rule, restricted by `ids` like the others). `doctorInputs` gains one statement: the counted refunds of the page's doctors (id, voucher, effective date, amount). Refunds are rare, so each is one row. Pending refund cheques are a memo figure (`pendingRefundCheques`), like pending incoming cheques.
**Effective date** of a refund (statement, FIFO order, month figures) is the payment date for cash and transfer, and the day a cheque was cleared. A cleared refund cheque that is later returned adds a credit line on the return date (the mirror of B3's `cheque_return`).

### 2.3 The allocation rule with refunds (X2, X3)
`allocate(opening, cases, payments, refunds = [])` — the B3/B4 behaviour is unchanged when `refunds` is empty (existing tests stay green, unchanged).
1. Items, oldest first: the positive opening balance (D4, always first), then **cases and counted refunds merged by date** (case received date / refund effective date). On the same date, cases come before refunds, then by case no. / voucher no.
2. Bound payments pay their case first (unchanged); excess and payments bound to cancelled cases join the pool.
3. The pool pays the items still owing, oldest first: opening, cases **and refunds**.
4. What is left is credit (plus a negative opening, unchanged).

Output gains `refunds: Map<id, {covered, remaining}>` and `refundsRemaining`.
**Tie-out (extends the B4 proof):** let `F` = Σ counted refunds, `f` = the part of them paid by the pool. `R = P + u + f + c`; `refundsRemaining = F − f`.
`Σ remaining + openingRemaining + refundsRemaining − credit = (T − P) + (max(o,0) − u) + (F − f) − (c + max(−o,0)) = o + T + F − R = balance`. ∎
The breakdown equation becomes `openingRemaining + casesRemaining + refundsRemaining − credit = balance`. `LedgerService.computeBreakdown` keeps refusing (500, logged) when it does not hold.

**Why a refund is a charge item.** Money the lab hands to a doctor is owed back, unless his credit covers it. When the credit covers it (the normal case), `refundsRemaining = 0` and nothing visible changes except a lower credit. When the credit stops covering it later (his cheque bounces after the refund), the debt appears on the refund's own line («استرداد OUT-000003 — متبقٍ 100.00»). It does not quietly re-open an old case, and the owner sees why the doctor owes money.

**Creation limit (X2):** a refund may not exceed the doctor's **refundable credit** = `max(0, −balance) − Σ pending refund cheques` (pending cheques reserve the credit, so two cheques cannot be written for the same credit). Otherwise the answer is `409 error.outgoing.refund_exceeds_credit {max}`. Voiding an incoming payment, or a returned incoming cheque, is **not** blocked by an earlier refund. The model above shows the result honestly.

### 2.4 Worked examples (2 decimals, minor units in brackets)
**R1 — full refund of an overpayment (B3 example 3).** Doctor F: case #501 (11-01) 100.00; cash 150.00 unbound (11-02) → balance **−50.00**, credit 50.00, refundable 50.00.
Refund cash 50.00 on 11-05 (OUT-000001): charges 100, received 150, paid_out 50 → balance **0.00** [0].
FIFO: case 100 (d 11-01), refund 50 (d 11-05); pool 150 → case 100, refund 50, credit 0.
(B) = 0 + 0 + 0 − 0 = 0 ✓. Statement: +100 (case), −150 (IN), +50 (OUT) → closing 0 ✓.

**R2 — partial refund.** Same doctor, refund 30.00 instead: balance = 100 − 150 + 30 = **−20.00**. Pool 150 → case 100, refund 30, credit 20. (B) = 0 + 0 + 0 − 20 = −20 ✓. Refundable after: 20.00.

**R3 — the incoming cheque bounces after the refund (the over-refund case).** Doctor K: case #601 (11-01) 200.00. Cheque 300.00 unbound, cleared 11-03 → balance −100.00. Refund cash 100.00 on 11-05 → balance 0.00. On 11-10 the cheque is returned: received 0 → balance = 200 − 0 + 100 = **300.00** [30 000].
FIFO: pool 0 → case #601 remaining 200, refund OUT remaining 100, credit 0. (B) = 0 + 200 + 100 − 0 = **300** ✓. Statement: +200, −300 (11-03), +100 (11-05), +300 (11-10 cheque return) → closing 300 ✓. The breakdown shows two open lines (the case and the refund), and the debts screen shows K as «مستحق لي 300.00».

**R4 — refund by cheque, all three states.** Doctor F again (credit 50.00): refund cheque 50.00 **pending** → balance −50.00 (unchanged), refundable **0.00** (reserved), memo «شيكات استرداد قيد الصرف 50.00». **Cleared** on 11-08 → balance 0.00, a statement line on 11-08. **Returned** on 11-12 (the lab's cheque bounced) → balance −50.00, a credit line on 11-12, refundable 50.00 again.

**R5 — order between a refund and a later case.** Doctor M: case A (11-01) 100.00; cash 150.00 unbound → credit 50. Refund cash 50.00 (11-05). Case B (11-10) 70.00. Balance = 170 − 150 + 50 = **70.00**. FIFO: A 100, refund 50, B 0 → B remaining 70; (B) = 0 + 70 + 0 − 0 = 70 ✓.

**R6 — expenses never touch a balance.** Rent 1 500.00 cash (11-01), materials cheque 800.00 pending, electricity 220.00 transfer, then voided. Every doctor's balance, the debts totals and the tie-out are byte-for-byte the same as before. Expenses report for November: rent 1 500.00 counted, materials 0 counted + 800.00 pending, electricity 0 counted + 220.00 voided. When the materials cheque clears on 11-20 it counts on 11-20.

**R7 — with the opening balance and a bound payment (B3 example 2 + refund).** Doctor E (opening +100, cases #201 300 / #202 200 / #203 150, cash 120 bound #202, cash 250 unbound, transfer 60 bound #203, balance 320). A refund to E is refused (`refundable = 0`, balance positive). The test asserts the 409 and that nothing changed (no voucher number taken).

All seven become unit tests of `allocate`/`breakdown` and API e2e tests built through the endpoints.

### 2.5 Tie-out test (B4 §1.4) extended
`ledger-tieout.e2e.spec.ts` keeps asserting A = B = C = D for every demo doctor, now with refunds in the demo (§5.5). The property test's generator adds refunds (cash/transfer/cheque in every state, voids, refunds made *before* an incoming cheque bounces). The mutation check gains one more injected bug: refunds left out of `balancesCte`. `ledger-scale.spec.ts` gets 10 000 outgoing payments (1 000 refunds) and keeps its structural assertions: a fixed statement count per page size, equality with `allocate` per sampled doctor, and `EXPLAIN` using the new partial index.

## 3. Rules: void, numbering, cheques, currency, idempotency, locks, permissions, audit

- **Void** (`POST /outgoing-payments/{id}/void`, `expenses.void`): reason 1..300, final, any cheque status (mirrors B3 D9: voiding a cleared cheque reverses the expense), voucher number never reused, `409 error.outgoing.already_void`, stale `rowVersion` → 409. A refund void lowers the doctor's balance back (credit returns). The voided row stays listed, struck through, with its reason.
- **Numbering:** `payment_out_no` counter, `UPDATE … RETURNING` inside the insert transaction after the locks; rollback gives the number back; a replay takes none. Test: N parallel creates → 1..N, no gaps; a forced failure → the next one reuses the number. `formatVoucher(direction, no)` → `IN-000001` / `OUT-000001`, one function.
- **Outgoing cheques:** created only through `POST /outgoing-payments` with `method = cheque` (number 1..30, bank 1..60 = the lab's bank, due date any date: post-dated cheques are normal). Same state machine (`pending → cleared | returned`, `cleared → returned`, `returned` final; B3 D3), same register endpoint `PATCH /cheques/{id}/status`, `status_date` ≥ payment date and ≤ today. **Duplicate check per direction:** the advisory-lock key and the query include the direction, so a doctor's cheque and the lab's own cheque with the same bank + number do not collide (X11).
- **Currency lock:** create outgoing takes `lockCurrencyForMoneyWrite` first; `currency_code` snapshot from the locked setting. The service invariant (no stored amount with a different code) checks both tables. `hasMoneyData` (§1.4). Tests: currency decimals locked after the first *outgoing* payment on a fresh install (first-run Playwright project), and a race between create outgoing and change decimals.
- **Idempotency:** `Idempotency-Key` required on `POST /outgoing-payments` (missing → 400). Replay → 200 + `Idempotent-Replayed: true`; same key, other body → 422. A key already used on the other table (incoming payment or case advance) → 422 too: the replay lookup checks both tables, and incoming creation gets the mirror check (one indexed lookup each). The web form keeps one key per attempt (B3 pattern).
- **Lock order (ADR-0010), extended:** currency SHARE → doctor row `FOR NO KEY UPDATE` (refunds only) → category row `FOR SHARE` (so a concurrent deactivate cannot slip in between the "active" check and the insert) → counter. Expenses take no doctor lock. Void and cheque status: doctor (if refund) → the row `FOR UPDATE`. Incoming writes are unchanged and already take the doctor lock, so a refund's credit check and an incoming void/cheque return on the same doctor are serialized. Concurrency test: a refund against a parallel incoming void / cheque return / second refund. One wins cleanly, there is no deadlock, and refundable credit never goes below 0 at commit.
- **Validation:** amount integer ≥ 1 minor unit; `paidAt` ≤ lab today; category exists and is **active** (`error.outgoing.category_inactive`); refund category ⇒ `doctorId` required and `payee` forbidden; other categories ⇒ `payee` required and `doctorId` forbidden (unknown and mismatched fields rejected, mass-assignment safe); inactive doctors may receive a refund (as they may pay, B3 D5); `cheque` fields iff method `cheque`.
- **Permissions (X10):** `expenses.read` list/get/summary/report; `expenses.write` create; `expenses.void` void. A refund also needs `ledger.read` (the form shows the doctor's credit). The cheque register shows outgoing rows only to callers who also have `expenses.read`, and the status change of an outgoing cheque needs `cheques.write` + `expenses.write`. Exports: `expenses.read` + `exports.run`. Cash flow: `ledger.read` + `expenses.read`. All granted to `owner`; 401/403 tests per route, including "`cheques.read` without `expenses.read` sees no outgoing cheque".
- **Audit (same transaction, user id, codes rendered per language):** `outgoing.created` `{voucherNo, kind, category, payee?|doctor?, method}`; `outgoing.voided` `{voucherNo, method, reason, chequeStatus}`; `cheque.status_changed` (existing, now with `OUT-` vouchers and `direction`); `export.created` (existing, new report codes). Amounts are in params, not in the text (B3 decision 9). Notes are never copied into the audit. Catalog keys `audit.outgoing.*` in ar and en.

## 4. Reports

### 4.1 Expenses report «تقرير المصاريف» (SPEC §5.9, §10)
- **Table:** `GET /outgoing-payments` with filters `categoryId, kind, doctorId, method, status, counted, from, to, search` (search = voucher, payee, doctor name, cheque no.), newest first, paged 25/100, filtering on the **voucher date** (like the receipts table, B4 decision 7).
- **Summary:** `GET /outgoing-payments/summary` (same filters except status/counted), one grouped query: counted total, count, **per category** `[{categoryId, name, kind, amount, count}]`, per method, **of which refunds to doctors**, pending outgoing cheques (count + amount, memo), voided (count + amount), «آخر دفعة». **Date basis = effective date** (a cheque counts on the day it cleared), labelled on screen «حسب تاريخ الصرف», so that "this month" equals Home's figure (X5). Test: the summary of the current month = `GET /ledger/summary.outgoingThisMonth`.
- Refunds appear as their own category row with the subtotal «منها استرداد للأطباء» shown apart. Home «المصاريف» = all counted outgoing money (SPEC §5.1 "total outgoing") (X4).

### 4.2 CSV (reuses the B4 export rules unchanged)
UTF-8 BOM, CRLF, comma (`CSV_DELIMITER`, S15 still open), money from integer minor units via `toMoneyInput` (no float), ISO lab dates, formula-injection neutralisation of text cells (payee, notes, bank, void reason, category names typed by the owner), no ids or phones, ASCII file names from `PRODUCT_NAME` + lab date, `Content-Disposition: attachment`, `no-store`, `nosniff`, one read-only REPEATABLE READ snapshot, 50 000-row cap (`422 error.export.too_large`), 10/min/user (429), audited before the file leaves (fail-closed), search text stored only as `hasSearch`.
| Export | Path | Columns |
|---|---|---|
| Outgoing payments | `GET /exports/outgoing-payments` (list filters) | Voucher · Payment date · Effective date · Category · Payee (payee text or doctor name) · Method · Cheque no. · Bank · Due date · Amount (ILS) · Status · Counted · Cheque status · Void reason · Notes |
| Expenses by category | `GET /exports/expenses-by-category` (`from, to`) | Category · Kind (expense / refund) · Count · Counted amount · Pending cheques count · Pending cheques amount. One row per category with activity; no totals row (B4 rule). |
| Debt breakdown (existing) | unchanged path | new rows of Type «استرداد / Refund» (date = effective date, Total = amount, Paid = covered, Remaining); new **last** column `رقم السند / Voucher` (empty for other rows) so existing column positions stay. `Remaining` still sums to the balance. |
| Doctor statement (existing) | unchanged path | new line types «استرداد / Refund» (debit) and «شيك استرداد مرتجع / Returned refund cheque» (credit); Reference `OUT-…`. |
Headers in ar/en from `csv.outgoing.*`, `csv.expensesByCategory.*`.

### 4.3 Cash summary (SPEC §10, low priority; X7)
`GET /ledger/cash-flow?from&to` (default: current lab month) → `{from, to, in:{total, cash, transfer, cheque}, out:{total, cash, transfer, cheque, expenses, refunds}, net}` by effective date, two grouped statements in one snapshot. "Cash" = money that actually moved (counted); the per-method split lets the owner read the cash-only figure. Shown as a panel «ملخص النقد للفترة» on the outgoing page, using the page's date range. No CSV (three numbers; can reuse `CsvTable` later).

## 5. API, screens, tests, demo data

### 5.1 API (`/api/v1`, Bearer, DTO-validated, unknown fields/keys rejected, error envelope with stable codes, ar/en)
`OutgoingPaymentResponse = {id, voucherNo:"OUT-000001", kind, category:{id,name}, doctor:{id,name}|null, payee|null, method, amount, currencyCode, paidAt, effectiveDate|null, notes, status, voidReason, voidedAt, counted, cheque: ChequeResponse|null, rowVersion, createdAt}`. `counted` and `effectiveDate` come from the server.

| # | Method + path | Permission | Request → response | Errors (beyond 400/401/403) |
|---|---|---|---|---|
| 1 | `POST /outgoing-payments` + `Idempotency-Key` | expenses.write (+ ledger.read for refunds) | `{categoryId, payee?, doctorId?, method, amount, paidAt?, notes?, cheque?}` → 201 `{payment, doctorBalance|null}`; replay 200 | 404 category/doctor; 409 `outgoing.category_inactive`, `outgoing.refund_exceeds_credit {max}`, `cheque.duplicate`; 400 `outgoing.payee_required`, `outgoing.doctor_required`, `outgoing.doctor_not_allowed`, `payment.date_in_future`, `payment.cheque_required/not_allowed`, `idempotency.required`; 422 `idempotency.mismatch` |
| 2 | `POST /outgoing-payments/{id}/void` | expenses.void | `{rowVersion, reason}` → `{payment, doctorBalance|null}` | 404; 409 `outgoing.already_void`, `concurrency.stale` |
| 3 | `GET /outgoing-payments` | expenses.read | filters §4.1 → `Page<OutgoingPaymentResponse>` + `totals:{counted, pendingCheques}` | — |
| 4 | `GET /outgoing-payments/{id}` | expenses.read | → response + cheque history | 404 |
| 5 | `GET /outgoing-payments/summary` | expenses.read | filters → §4.1 summary, `basis:"effective"` | — |
| 6 | `PATCH /cheques/{id}/status` (extended) | cheques.write (+ expenses.write for out) | unchanged → `{direction, payment|null, outgoing|null, doctorBalance|null}` | as B3 |
| 7 | `GET /cheques`, `GET /cheques/summary` (extended) | cheques.read (out rows: + expenses.read) | `+ direction=in|out|all` → rows gain `direction`, `party:{kind:'doctor'|'payee', name}`, `voucherNo`; summary counts per direction | — |
| 8 | `GET /doctors/{id}/balance` (additive) | ledger.read | → `+ paidOut, pendingRefundCheques, refundable` | 404 |
| 9 | `GET /doctors/{id}/statement` (additive) | ledger.read | kinds `+ refund, refund_cheque_return`; `ref` = `OUT-…` | 404 |
| 10 | `GET /doctors/{id}/debt-breakdown` (additive) | ledger.read + cases.read | `figures.paidOut`, `refundsRemaining`, `openRefunds:[{id, voucherNo, date, amount, covered, remaining}]`, `tieOut.refundsRemaining` | 404; 500 if the tie-out fails |
| 11 | `GET /ledger/summary` (additive) | ledger.read | `+ outgoingThisMonth, outgoingTotal` (null without expenses.read); the cheques-due figures count both directions (X11) | — |
| 12 | `GET /ledger/cash-flow` | ledger.read + expenses.read | `?from&to` → §4.3 | 400 range |
| 13 | `GET /exports/outgoing-payments`, `GET /exports/expenses-by-category` | expenses.read + exports.run | filters, `lang?` → `text/csv` | 422 `export.too_large`; 429 |
| 14 | `GET /search` (additive) | search.use (+ expenses.read for out) | the payments group also matches `OUT-000012` / `out12`; bare digits match both directions | — |

Response note on #6: `payment` becomes nullable. The web client is regenerated in the same commit (`contract:check`); nothing outside this repo consumes the API (single-install product).
New catalog keys (API, ar+en): `error.outgoing.*`, `audit.outgoing.*`, `csv.outgoing.*`, `csv.expensesByCategory.*`, `cheque.direction.*`, `statement.kind.refund*`, `outgoing.kind.*`. OpenAPI documented; `openapi:export` + `api:generate` committed.

### 5.2 Frontend (stage 2; skills `smile-artec-web-*`, `frontend-design` for the new page)
- **Route `/outgoing` «إنشاء دفعة صادرة»** (sidebar item after «دفعة واردة»; no dead item, it ships working). Top: `OutgoingForm`. The category `EntityPicker` (active categories) switches the party field: a **payee** text field, or for the refund category a **doctor picker** that shows his refundable credit and refuses, with a reason, when it is 0. Then amount `MoneyField`, method radios cash/transfer/cheque (cheque fields appear only for cheque), date `DateField`, notes → «حفظ المصروف»; toast «✅ تم حفظ المصروف» (+ new balance for a refund). One `Idempotency-Key` per attempt.
- Below: `ExpensesSummary` (per-category totals, refunds subtotal, pending cheques, voided, «آخر دفعة», label «حسب تاريخ الصرف»), `CashFlowPanel` (period = the page's range), the table (voucher, date, category, payee/doctor, method, amount, status chip, counted), filters in the URL (`useUrlState`: category, kind, method, status, from, to, q, page), «تصدير CSV» ×2 (`ExportButton`), row action «إلغاء الدفعة» (the B3 void dialog, generalised). Void rows struck through with the reason.
- **Cheque register:** chips «الكل / واردة / صادرة» in addition to the status chips, with counts from the summary; a «الجهة» column (doctor or payee); the voucher links to its list. Status dialog unchanged (`allowedStatuses`).
- **Doctor page:** an «استرداد رصيد» action (`ActionButton`, disabled with the reason «لا يوجد رصيد دائن للاسترداد» when `refundable = 0`) opens `OutgoingForm` in a dialog with the category and doctor fixed. Statement shows refund lines. The balance card shows `paidOut` and pending refund cheques.
- **Debts breakdown dialog:** refund lines (voucher, date, amount, covered, remaining); the equation footer gets the refunds term.
- **Home:** «دفعة صادرة» card → link to `/outgoing` with «المصاريف هذا الشهر»; `KeyNumbers` gains expenses this month. The cheques card counts due/overdue in both directions.
- **Search:** OUT vouchers land on `/outgoing?q=OUT-000012`.
- Data: `features/outgoing/api.ts` (key factory + `queryOptions`); `refreshMoney()` also invalidates outgoing, summary, cash flow and the categories picker. Nothing computed in the browser (`counted`, `refundable`, `allowedStatuses`, balances all from the API).
- States: loading skeleton, empty («لا توجد مصاريف مسجلة بعد.» + the form), error (route boundary + retry), disabled-with-reason, 403 message. Every string in `ar.json` + `en.json` (plural forms), logical CSS only, one `h1`, labelled landmarks/dialogs, focus returns to the trigger, status never by colour alone, `dir="auto"` for payee/doctor names, `Td kind="money"` for amounts.

### 5.3 Tests
**Unit (Jest/Vitest, pure):** `allocate`/`breakdown`/`doctorBalance` with refunds: R1–R7, same-date ordering, refund before/after cases, over-refund, refunds only, empty refunds = the B4 results exactly (snapshot of the existing fixtures). Property tests: the extended invariant, no item over-paid, permutation invariance. `refundable()` incl. pending refund cheques. `isCounted` × both tables. `formatVoucher(direction)`. Category/party rule. Request-hash canonicalisation for the new body. CSV rows for the two new exports (injection table, money text 0/2/3 decimals).
**Integration (Testcontainers PostgreSQL 16):** migration 0007 on empty and on 0006 + data; constraints reject (party rule, two cheque owners, no owner, amount ≤ 0, void without reason); `countedWhere(outgoing)` equals `isCounted` over the matrix; `balancesCte` = `doctorBalance` with refunds; **concurrency**: parallel outgoing creates (gap-free OUT numbers, independent of IN numbers), parallel same key, refund vs incoming void / cheque return / second refund on one doctor (refundable never negative at commit, no deadlock), create vs category deactivate, create vs currency change, parallel void; rollback returns the number; `ledger-scale.spec.ts` with outgoing data (structural assertions, EXPLAIN, timings logged; target: no B4 figure more than +20 % slower, `GET /cases` p95 ≤ 150 ms).
**API e2e (Supertest):** 401/403 per route incl. the mixed-permission cases of §3; every error code in ar and en; R1–R7 built through the API with the hand numbers; replay 200 and cross-table key 422; statement, breakdown, debts, balance and Home figures after each step; **every-demo-doctor tie-out with refunds**; CSV bytes (BOM, CRLF, headers ar/en, row count = list total, injection neutralised, `Remaining` sum = balance for a refund doctor), audit rows (user id, no notes, no search text), 422/429; the summary month = Home month; `TZ=UTC` with a non-UTC lab zone (identical figures and files); category delete → `deactivated` once used, and the refund category cannot be deleted or deactivated.
**Web unit/component (Vitest):** `OutgoingForm` (payee ↔ doctor switch, cheque fields, refundable shown and enforced only as guidance, Arabic inline errors, server field errors, key reuse on retry / new key after success, double-click sends once), summary and cash-flow states, register direction chips and URL state, doctor refund action disabled reason, breakdown refund lines, Home card link and figure, i18n parity, RTL guard.
**E2E (Playwright + axe, ar and en, `TZ=UTC`, each test seeds its own data through the API with `uid()` names):** record a rent expense → summary and table update, CSV downloaded and read (BOM, Arabic header, row count); expense by cheque pending → cleared in the register → counted in the report; void with reason; refund of a doctor's credit from his page → balance 0, statement line, breakdown equation; the R3 flow (refund, then his cheque returns) → debts shows him owing with the refund line; register filters «صادرة» round-trip through the URL; currency locked after the first outgoing payment (first-run project); Home outgoing card exact figures (`demo` project); `expectAccessible` on every page and dialog; layout (text edges of new money columns, no sideways scroll at 1280 px); screenshots of the new page, the register and the refund dialog in both languages.
**Contract drift:** `npm run contract:check`.

### 5.4 Commands run and reported at each gate
lint, typecheck, i18n:check, rtl:check, unit, integration, API e2e, web tests, build, contract:check, `test:e2e:web` (throwaway `*_e2e` container, never the development database).

### 5.5 Demo seed additions (`scripts/demo`, through the real API only)
- Expenses in every non-refund category over the last three months: cash, transfer, and cheques pending (due in 3 days), pending overdue, cleared, returned; one voided expense; one category deleted after use (shows as inactive).
- Refunds: the existing overpaying doctor gets a **partial** cash refund (credit remains); a second credit doctor gets a **full** refund by a cheque that is **cleared**; a third has a refund cheque still **pending** (refundable 0); the R3 scenario (refund, then his incoming cheque returns) in the `extras` set, so the base Home "owed to the lab" figure stays easy to check.
- `demo-seed.spec.ts` and `home-demo.spec.ts` expected numbers updated in the same commit; the tie-out e2e runs with extras.

## 6. Order and gates (one branch, backend then frontend)

**Stage 0 — checks, no product code (≈ ½ day):** owner answers X1–X11; migration dry run of the `cheques` ALTER on a copy of the B4 demo DB; extend `large-dataset.ts` with outgoing data and record the baseline of the B4 table (cases list, doctors list, debts, heavy balance/breakdown) on this machine.

**Stage 1 — backend, one logical change per commit:**
1. Pure domain: `allocate`/`breakdown`/`doctorBalance` with refunds, `refundable`, `formatVoucher(direction)` + R1–R7 + property tests (existing tests unchanged and green).
2. Migration 0007 + Drizzle schema + `hasMoneyData` + migration tests.
3. Outgoing create / void / get / list (+ idempotency across tables, locks, currency, audit, validation).
4. Cheques: second owner in register, summary, status change and duplicate check; direction filter.
5. Ledger: `balancesCte`, `doctorInputs`, balance, statement, breakdown, debts, Home summary with refunds; tie-out tests extended; `ledger-scale` re-measured.
6. Expenses summary, cash flow, the two exports + extended breakdown/statement CSV.
7. Search OUT vouchers.
8. OpenAPI export + client, catalogs ar/en, demo seed, docs.
**Gate 1** (real output reported): lint, typecheck, i18n:check, unit, integration, API e2e (incl. tie-out with refunds), build, contract:check. Red → fix before stage 2.

**Stage 2 — web:** `/outgoing` page (form, summary, cash flow, table, exports, void); sidebar; register direction; doctor refund action + statement/breakdown lines; Home card and key number; search landing; catalogs; component tests; Playwright + axe + screenshots.
**Gate 2:** Gate 1 + web tests, rtl:check, `test:e2e:web` (ar + en, `TZ=UTC`).
**Docs in the last commit:** SPEC edits (§0 list), production-readiness (S10 and S18 closed; #14 updated; new rows: over-refund shown as debt on the refund line, cross-table idempotency, outgoing cheques in B5 notifications), skills `money-ledger` (refunds in FIFO, extended tie-out, outgoing table) and `web-api-data` (outgoing form, `refreshMoney`), this plan's "decisions taken while building". No push; PR only after the owner's go-ahead.

## 7. Risks

1. **Ledger regression (highest).** Refunds enter four computations (`balancesCte`, `doctorInputs`/`allocate`, statement, Home/debts). Mitigation: separate table (no existing query changes meaning), the tie-out test over demo, random and large data, a mutation check for "refunds missing in `balancesCte`", the runtime breakdown assertion.
2. **Cheque register ALTER on a B3 table.** Expand-only, tested on 0006 + data; every incoming query reaches cheques through `payments.id`, so outgoing cheques cannot leak into incoming figures (tested: incoming summaries unchanged after adding outgoing cheques).
3. **Refund credit races.** Doctor lock on every money write for that doctor; concurrency tests.
4. **Over-refund after a bounce** looks surprising. Shown on its own line with the voucher, and explained in the breakdown; the owner confirms the rule (X2/X3).
5. **Two semantics of "this month"** (voucher date in the table, effective date in the summary): labelled on screen, tested against Home (B4 O3 precedent).
6. **Category delete now deactivates** once used. Already the B1 rule, but the owner will see it for the first time; the toast says «تم التعطيل» (existing).
7. **Cross-table idempotency** is a service check, not a DB constraint. One indexed lookup in each create, plus a test for both directions.
8. **Home figure change:** the cheques card starts counting outgoing cheques (X11); the `home-demo` expected numbers change in the same commit.
9. **Performance:** one more CTE and one more input statement per page; re-measured in stage 1 against the B4 numbers.
10. **Scope creep:** suppliers, staff ledgers, voucher printing and the separate void page stay out (X6, X9); B5 notifications reuse the data later.

## 8. Needs owner decision (each has a recommended default; approving the plan without comment = defaults)

| # | Question | Default (recommended) | Alternative |
|---|---|---|---|
| **X1** | Where outgoing payments live. | Separate `outgoing_payments` table; `cheques` shared with a second owner column (§1.1). SPEC §8 note updated. | `direction` column on `payments` (SPEC §8 literal); rewrites the B3 ledger queries. |
| **X2** | Refund larger than the credit. | Refused at creation (limit = credit − pending refund cheques). If the credit shrinks later (bounce, void), the uncovered part is debt shown on the refund line. | Allow any refund with a confirmation; the excess becomes debt at once. |
| **X3** | Where a refund sits in the FIFO. | As a dated charge item among the cases (like the opening balance, D4); debt from an over-refund shows on the refund line. | Subtract refunds from the pool before allocation; an over-refund re-opens the newest cases instead. |
| X4 | Refunds in the expenses report and Home «المصاريف». | Included: the refund category is a row of the report with the subtotal «منها استرداد للأطباء»; Home = all outgoing (SPEC "total outgoing"). | Report and Home show expenses only; refunds only on the doctor screens. |
| X5 | Date basis of the expenses summary. | Effective date (a cheque counts the day it cleared), labelled; equals Home's month figure. The table filters by voucher date. | Voucher date everywhere. |
| X6 | Separate «إلغاء دفعة» page (SPEC §4/§5.10). | Not now: void stays a row action on both payment pages (B3 D6). | Build one page listing in and out together. |
| X7 | Cash summary (SPEC §10, low priority). | Build `GET /ledger/cash-flow` + a panel on the outgoing page for the chosen period. | Defer. |
| X8 | Expense categories in use. | Delete → deactivated automatically (B1 rule); inactive ones hidden from the form, kept in reports; the refund category is never deleted or deactivated. | Block deletion of a used category with a message. |
| X9 | Payee and technicians. | Payee = free text 1..100 (no supplier list, §3.2); a salary is a «رواتب» expense with the name typed; no link to technicians (SPEC §7.2). | Optional technician picker on salary expenses (still no technician ledger). |
| X10 | Permissions. | New `expenses.read/write/void` (so a future reception role can take money in without paying money out); refunds also need `ledger.read`. | Reuse `payments.*`. |
| X11 | Outgoing cheques. | Number, bank (the lab's) and due date required; due date may be in the future; duplicate check per direction; the Home cheques card counts due/overdue cheques of both directions. | Bank optional; Home card stays incoming only. |

X1–X3 change accounting behaviour (like B3's D2/D3/D9), so after approval they are listed in production-readiness under "pending owner sign-off (Ibrahim)" until signed in person.

---

## Measured numbers (stage 1)

Same machine and dataset as B4 (`test/support/large-dataset.ts`: 500 doctors, 20 000 cases, 50 000 payments), now with **10 000 outgoing payments (1 000 refunds)** and the lab's cheques in every state. Because this machine was slower on the day than when B4 was measured, `main` was measured again the same day, in a temporary worktree, for a fair baseline. p50 / p95 in ms.

| Request | `main` today | B4b branch |
|---|---|---|
| statements per `GET /cases` at page size 5 / 25 / 100 | 7 / 7 / 7 | **8 / 8 / 8** (one more: the refunds of the page's doctors; still constant) |
| `GET /cases?pageSize=25` | 176 / 203 | 181 / 254 |
| `GET /cases?pageSize=100` | 246 / 622 | 252 / 310 |
| `GET /cases?doctorId=<heavy>&pageSize=25` | 174 / 268 | 150 / 214 |
| `GET /doctors?pageSize=25` | 45 / 72 | 31 / 74 |
| `GET /doctors/{heavy}/debt-breakdown` | 172 / 215 | 160 / 211 |
| `GET /doctors/{normal}/debt-breakdown` | 22 / 25 | 20 / 65 |
| `GET /debts` | 31 / 33 | 27 / 44 |

The differences are within run-to-run noise (single runs, 10–20 samples each); no B4b regression is visible. Both columns are above the B4 figures (`GET /cases` p95 101 ms), and `main` is too, so that is the machine on the day, not this branch. Production-readiness #15/B8 load test stays the place for a controlled measurement.

## Decisions taken while unattended

Written during stage 1, after the owner approved the plan with defaults for X1–X11 and the three conditions. Each is the safest default and easy to change.

1. **Existing response shapes are kept; new shapes sit beside them** (the web is not touched in stage 1 and must keep compiling):
   - `GET /cheques` and `/cheques/summary` stay incoming-only. The two-direction register is `GET /cheques/register` and `/cheques/register/summary` (items carry `direction`, `party {kind: doctor|payee}`, `category`). Stage 2 moves the screen there and removes the B3 list endpoints (production-readiness S22).
   - An outgoing cheque's status changes at `PATCH /outgoing-cheques/{id}/status`, which answers the outgoing payment. `PATCH /cheques/{id}/status` answers 404 for an outgoing cheque and the new route 404 for an incoming one (plan §5.1 #6 had one route with a nullable `payment`; that would have broken the current web types).
   - Search: a separate `outgoing` group (needs `expenses.read`) instead of mixing OUT- vouchers into the `payments` group. Bare digits still match IN- in the payments group and OUT- in the outgoing group.
   - Home: `GET /ledger/summary` keeps its incoming figures as they were and gains `outgoingThisMonth`, `outgoingTotal`, `outgoingChequesDueSoon`, `outgoingChequesOverdue` (null without `expenses.read`). X11 ("the cheques card counts both directions") becomes a sum of the two in stage 2, not a change of the existing field.
2. **The only web change in stage 1** is a type fix forced by the regenerated client. The statement line `kind` gained `refund` and `refund_cheque_return`. The statement table now takes its type from the generated schema, and both web catalogs label the two kinds, so a refund line in the current statement screen has a real label.
3. **The breakdown CSV gained a last column `Voucher`** (filled on refund rows). The two B4 tests that compare the exact header and the credit row were updated to the 9-column file (strict equality kept).
4. **B4 tests with exact objects** (`tieOut` of the breakdown, the Home summary) now also expect `refundsRemaining: 0` and the four outgoing Home figures as 0. They are extended, not loosened.
5. **A refund needs `ledger.read` as well as `expenses.write`** (403 otherwise; the server checks it after reading the category). The outgoing cheque status needs `cheques.write` + `expenses.write`; the register hides outgoing rows from a caller without `expenses.read` (an empty page, not 403).
6. **Lock order as planned:** currency SHARE → doctor (refunds only, then the refundable check under that lock) → category SHARE → duplicate-cheque advisory lock → OUT- counter. The kind is read from the category before the locks; `is_doctor` never changes after setup.
7. **Cross-table idempotency** is a service check in three places (incoming payment, case advance, outgoing payment). A key used on one table answers 422 on the other (production-readiness S20 notes the theoretical simultaneous-first-use gap).
8. **Effective date of an outgoing payment** is in the API response (`effectiveDate`, null while it does not count). The statement places a refund cheque on the day it cleared and adds a credit line if it later returns (`refund_cheque_return`), mirroring B3.
9. **Expenses summary per category** lists categories with counted money or pending cheques in the period, inactive ones included. Voided money is a memo total, not per category.
10. **Cash flow** answers 400 `error.ledger.range_invalid` when `from` is after `to`. Its default is the current lab month up to today.
11. **Demo seed:** the base demo gains expenses over three months, the lab's cheques in every state, a voided expense, a category deleted after use, and a partial cash refund plus a pending refund cheque on the overpaying doctor. The extras gain a full refund by a cleared cheque (the cancelled-case credit doctor) and the R3 doctor «د. رامي الشيك المرتجع». The base demo still has 15 doctors and 40 cases, and its incoming Home figures are unchanged. The tie-out test now expects 15 + 8 doctors.
12. **Owner condition 1 is covered at three levels:**
    - Repository level (`test/integration/outgoing-schema.spec.ts`): every incoming read before and after outgoing rows, including the same bank + cheque number on both sides.
    - HTTP level (`test/e2e/outgoing-isolation.e2e.spec.ts`): 14 incoming reads, CSV bytes and search included, and 8 outgoing reads, each byte-identical after money of the other direction is added.
    - Database level: the CHECK refuses cheques with 0 or 2 owners, on insert and on update.
13. **Owner condition 2:**
    - The property test with refunds (10 seeds × 200 ledgers, each also run in a "bounce" shape where payments stop counting while refunds stay) and two mutation checks (refunds missing from the balance, refunds missing from the allocation) are in `src/modules/payments/domain/refunds.spec.ts`, next to the B4 ones in `breakdown.spec.ts`.
    - The every-demo-doctor tie-out includes refunds, the R3 doctor and the balance formula.
    - The 500-doctor scale test passes refunds into every equality.
14. **Playwright was not run** in stage 1 (no screen changed except one label type; stage 2 runs it). The web unit tests were run.

## Stage 2 (screens): measured numbers and decisions taken while unattended

Written during stage 2, on the same branch, with the same rules: the safest default, recorded here, easy to change. The backend was not touched.

### Step 0 re-check (before any web work)

The owner-permissions test was edited after the last full run, so everything was run again from the committed tree: lint, typecheck, i18n:check, rtl:check, `contract:check` (no drift), API unit (355), integration (96), API e2e (365), web unit (272). All green. `GET /cases?pageSize=25` was re-measured with `ledger-scale.spec.ts` on this machine on the same day, three runs each, `main` in a temporary worktree:

| `GET /cases?pageSize=25` (500 doctors, 20 000 cases, 50 000 payments, 20 samples per run) | p50 | p95 |
|---|---|---|
| `main` (3 runs) | 176 / 185 / 180 ms | **217 / 213 / 212 ms** |
| B4b branch (3 runs; the data also holds 10 000 outgoing payments) | 193 / 189 / 184 ms | **234 / 253 / 234 ms** |

The branch is about 10 % slower at p95 (4 % at p50), inside the plan's "no B4 figure more than +20 %" limit and consistent with the one extra statement (the refunds of the page's doctors). **The plan's absolute target of 150 ms p95 is not met by either side on this machine today** (`main` is at 212 ms), so it cannot be judged here; it stays with the controlled load test of production-readiness #15.

### Decisions

15. **The register moved to `GET /cheques/register` (+ `/summary`).** The B3 endpoints `GET /cheques` and `/cheques/summary` are still in the API (the task forbids backend changes), but the web no longer calls them. Removing them is listed in production-readiness S22 as the one remaining step.
16. **Status chip counts hide under a direction chip.** The register summary has no direction filter, so its status counts cover both directions; showing them next to «صادرة» would be wrong. Direction chips always show their counts (they ignore the status filter). The pending amount shows both directions («واردة قيد التحصيل / صادرة قيد الصرف»), or the one chosen.
17. **The category on the form is a native select of the active categories** (not an `EntityPicker`): the list is short, the form needs the `isDoctor` flag of the choice, and the refund category must never be hidden by a search. The report's category filter lists every category, inactive ones marked, because reports keep old categories (X8).
18. **The sidebar item «دفعة صادرة» needs `expenses.read`; the form needs `expenses.write`; the void button `expenses.void`; the cheque-status button `cheques.write` + `expenses.write`; the cash panel `ledger.read` + `expenses.read`.** The server checks every request anyway. A refund also needs `ledger.read` (the form reads the doctor's balance); the doctor-page button needs both `expenses.write` and `ledger.read`.
19. **The refund limit in the form is guidance.** The form shows the refundable credit, refuses an amount above it (and any amount at 0) with the reason, and sends nothing; the server's `409 error.outgoing.refund_exceeds_credit` still wins and its message is shown. The «استرداد رصيد» button stays visible but disabled with the reason «لا يوجد رصيد دائن للاسترداد» while nothing is refundable (credit fully reserved by refund cheques included).
20. **Home.** The outgoing card is a live link with «مصاريف هذا الشهر» (no figure when the API sends `null`, i.e. without `expenses.read`). «الأرقام الرئيسية» gets «المصاريف هذا الشهر» (left out when `null`, never shown as zero). The cheques card adds the lab's own due-soon and overdue cheques to the doctors' (X11); a `null` counts as zero there.
21. **Search.** The `outgoing` group (title «المصاريف») opens `/outgoing?q=OUT-…`; «عرض الكل» opens the page with the same text.
22. **Success text.** «✅ تم حفظ المصروف OUT-000001.»; a refund adds «(استرداد). الرصيد الجديد: …». The tick is part of the catalog string, as the SPEC writes it.
23. **`FormDialog` now returns the focus to the control that opened it** (it remembers the opener when it opens and restores it on close). Before, every dialog opened by state dropped the focus on `body` because Radix has no trigger there. Found by the Playwright check "focus returns to the trigger" on the refund dialog; fixed once in the shared component, with a unit test.
24. **A fourth Playwright project, `first-run-outgoing`** (a second empty installation). The first-run file locks the currency with the first price, so it cannot show the lock caused by the first *outgoing* payment; this project does, and also shows the empty expenses page of a new installation in both languages. `readDownload` moved from `b4.spec.ts` to `support.ts` (same code) so two specs share it.
25. **Existing specs updated, not weakened:** Home (six live cards, one «قريباً», the outgoing card in the tab order, the new key number), the cheque-register unit test (new routes, new columns), the breakdown test fixtures (the new fields), the first-run Home card count (5 → 6 links, 2 → 1 «قريباً»), the demo Home figures (expenses and the two-direction cheques card checked against the expenses report, a different endpoint than the one the card reads).
26. **Environment note.** In this session the web unit tests failed under the Bash tool ("Vitest failed to find the current suite", cause not established) and passed in PowerShell; all web unit results below come from PowerShell.
