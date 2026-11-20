# B5 — Delivery flow, cheque rules check, notifications feed, and the backlog (plan)

Status: **approved 2026-11-20 (defaults N1–N10, with three conditions); B5 (items 1–13) built on this branch — see §13 build notes and §14 decisions taken while unattended.** B5b (items 14–18) is a separate branch after B5 is merged.
Branch: `feat/b5-delivery-notifications-backlog` (from `main` at `4b59eee`, after PR #13, B4b).
Sources read (2026-11-20): SPEC §3, §4, §5.1/5.5/5.6/5.7/5.13/5.16, §6.1, §7, §8, §9, §10, §11, §12; CLAUDE.md; ENGINEERING_STANDARDS; `docs/production-readiness.md`; `docs/plans/b3-payments.md`, `b4-debts-reports-search.md`, `b4b-outgoing-expenses.md`; skills feature-workflow, money-ledger, db-migrations, security-review, `smile-artec-web-*`. Code read: `case-rules.ts`, `CasesService.changeStatus/cancel`, `cases.ts` schema (indexes, `cases_delivered_date_ck`), `payment-rules.ts` (`isCounted`, cheque `TRANSITIONS`, `dueState`), `ChequesService.changeStatus/changeOutgoingStatus`, `payments.controller.ts` (`@Controller('cheques')`), `outgoing.controller.ts` (`cheques/register`), `CaseDialogs.tsx` (status dialog), `ActionCards.tsx`, `UserMenu.tsx`, `router.tsx`, `vite.config.ts`, `e2e/first-run.spec.ts`, `e2e/first-run-outgoing.spec.ts`, `e2e/cases.spec.ts`, `e2e/support.ts`, `playwright.config.ts`.

B4b delivered outgoing payments, expenses, refunds, the expenses report and the cash summary (S10, S18 done). They are not listed as missing below.

---

## 1. Backlog inventory

How it was built: every row of `docs/production-readiness.md` not marked done; every "Not done", "deferred", "left alone", "Needs owner decision" and "Decisions taken while unattended" item in `docs/plans/*.md`; a search for `TODO|FIXME|HACK` (none in `apps`, `packages`, `scripts`); a search for `.skip|.only|.todo|.fixme|xit|xdescribe` (none); a search for `waitForTimeout` (two: `e2e/cases.spec.ts:323` in a test, `e2e/support.ts:36` only when screenshots are taken); «قريباً» placeholders (one: the «إنشاء فاتورة» Home card); SPEC §3.1/§5 screens compared with the routes in `router.tsx`.

Classes: **(A)** include in B5 or B5b · **(B)** later phase (named) · **(C)** needs the owner · **(D)** out of scope / won't do. Sizes: S ≤ ½ day, M ≤ 2 days, L > 2 days.

### 1.1 Roadmap B5 and items that belong with it

| # | Item | Source | Size | Class |
|---|---|---|---|---|
| 1 | Delivery dialog «تسليم الحالة»: received money full / part / none, collect date, «هذه الحالة مسلّمة بالفعل.» | SPEC §5.7, §9; B3 plan §6 note | L | **A — B5** |
| 2 | `cases.collect_on`: store, show and edit the collect date; «تحصيل مستحق» when it is reached | SPEC §5.7, §5.16, §8 | M | **A — B5** |
| 3 | Notifications feed + bell with unread count (cases due ≤ 2 days / overdue, cheques due ≤ 7 days / overdue, collect due) | SPEC §4, §5.16; UserMenu comment "bell arrives with its own slice" | L | **A — B5** |
| 4 | Outgoing cheques due / overdue in the feed | production-readiness S21 | S | **A — B5** |
| 5 | Cheque status transitions: verify every §7.4 rule has a test in both directions; close gaps (§3) | SPEC §11 B5 row | S | **A — B5** |
| 6 | Cheque status date may be earlier than the date the cheque cleared (`status_date` is checked only against `paid_at`, `cheques.service.ts:55` and `:99`), so a "returned" line can sort before its "cleared" line | read in code, to confirm by a failing test | S | **A — B5** |
| 7 | Remove `GET /cheques` and `GET /cheques/summary` (B3, incoming only, no longer called by the web), their DTOs and tests; regenerate `openapi.json` and the client | production-readiness S22; B4b decision 15 | S | **A — B5** |
| 8 | Record the B6 hook "cancel from returned is blocked once invoiced" next to `canCancel` and in the B6 roadmap (no enforcement possible before invoices exist) | S13; B3 decision 12; SPEC §7.8 | S | **A — B5** (record only) |

### 1.2 Test and tooling hygiene

| # | Item | Source | Size | Class |
|---|---|---|---|---|
| 9 | `first-run.spec.ts` Home test switches to English and back without waiting for the language save; later tests assume Arabic. Apply the `first-run-outgoing` fix: wait for the `PATCH /settings/language` response, no sleep | owner; B4b `66073ee` | S | **A — B5** |
| 10 | First-run Playwright: "a payment alone locks the currency". The API e2e has it (`payments.e2e.spec.ts:112`); the browser test locks with a price, so the payment path is never seen in the UI (B3 plan §4.5c promised it) | B3 plan §4; owner | S | **A — B5** |
| 11 | `e2e/cases.spec.ts:323` waits 150 ms after scrolling; replace with `expect.poll` on the chart box | search | S | **A — B5** |
| 12 | `NewCasePage.test.tsx` times out under load (5 s Vitest default) | earlier reports | S | **A — B5** |
| 13 | Web unit tests run only from a shell whose working directory is spelled `c:/Projects` ("Vitest failed to find the current suite" from `/c/Projects` or the Bash tool) | B4 decision 14; B4b decision 26; testing skill | S | **A — B5** (fix, else document) |

### 1.3 Screen quality (proposed B5b)

| # | Item | Source | Size | Class |
|---|---|---|---|---|
| 14 | Narrow screens: cases, doctors, payments and debts lists scroll the whole page sideways at 390 px RTL (also WCAG 1.4.10 reflow). Fix: the table scrolls inside its card; check every list, not only these four | S14; B4 decision 12 | M | **A — B5b** |
| 15 | Bundle over 500 kB (one chunk; 1,030 kB / 310 kB gzip after F2b, more after B3–B4b). Route-level code splitting with React Router `lazy`; re-measure | production-readiness #21 | M | **A — B5b** |
| 16 | Home «آخر العمليات»: last 20 audit entries, rendered per language (no read endpoint exists for `audit_log`) | SPEC §5.1; S8 | M | **A — B5b** |
| 17 | Shade picker «الأكثر استخدامًا» row (usage counts from case lines) | SPEC §5.5; S3 | S | **A — B5b** |
| 18 | Accessibility / i18n / RTL sweep: axe at 390 px on every route (today only 1280 px and the B4 dialogs), keyboard path of the new bell and delivery dialog. Reading found no other gap: `i18n:check` covers both API and web catalogs with plural forms, `rtl:check` and `local/no-literal-text` are in CI | inventory | S | **A — B5b** (axe for the new B5 screens is in B5) |

### 1.4 Later phases

| # | Item | Source | Size | Class |
|---|---|---|---|---|
| 19 | Invoices (3 types), immutable snapshot, void; «إنشاء فاتورة» card stops being «قريباً»; Home «الفواتير» figure; «مغلقة» chip | SPEC §5.1, §5.14, §9; S7 | L | **B — B6** |
| 20 | Enforce "a case on an active invoice cannot be edited or cancelled" (including from returned) | S13, SPEC §7.8 | S | **B — B6** |
| 21 | `hasMoneyData` must add invoices | production-readiness #14 | S | **B — B6** |
| 22 | Invoice appearance «مظهر الفاتورة», printing of invoice / statement / receipt / OUT- voucher, document language setting | SPEC §5.8, §5.14, §5.15, §6.1 | L | **B — B6** |
| 23 | Settings «البيانات والنسخ الاحتياطي»: backup now, restore, automatic backups, restore offer in the wizard | SPEC §5.18, §2.1 | L | **B — B7** |
| 24 | Code signing, installer branding, diagnostics bundle, third-party notices, clean-VM matrix | production-readiness #2, #5, #6, #9, #10 | L | **B — B7** |
| 25 | Access token valid ≤ 15 min after password change; lockout as DoS; in-memory rate-limit store; export caps | production-readiness #11, #12, #13, S16 | S each | **B — B8** |
| 26 | Controlled load test: `GET /cases` p95 target 150 ms not met on this machine (212 ms on `main`); search speed revisit | B4b stage 2 numbers; #15 | M | **B — B8** |
| 27 | Patient names visible to any `cases.read` user in search | production-readiness #19 | S | **B — B8** (when roles exist) |
| 28 | «Manual financial audit» tool in Settings (nice-to-have) | SPEC §7.8 | M | **B — B8** |

### 1.5 Needs the owner

| # | Item | Source | Size | Class |
|---|---|---|---|---|
| 29 | Sign-off in person (Ibrahim) of B3 D2, D3, D9 and B4b X1, X2, X3 (built, change accounting behaviour) | production-readiness | — | **C** |
| 30 | Open the three CSV files in the owner's Excel (comma vs `;`) | S15; B4 plan §2.4 | S | **C** |
| 31 | Confirm the refund line reads well in the debts breakdown | S19 | — | **C** |
| 32 | Same tooth twice: keep "allow several lines", or ask "replace or add" | S4 | S | **C** |
| 33 | Work-type colour setting for the tooth chart | S5 | M | **C** |
| 34 | Licensed tooth-chart artwork (artwork layer only) | S6; SPEC §1.1 | M | **C** |
| 35 | Arabic-Indic digits setting (SPEC §6.1 mentions "a setting"; no milestone owns it) | SPEC §6.1 | S | **C** |
| 36 | Trademark / domain for «Basma»; resale licence terms; written ownership agreement | production-readiness #1, D1–D3 | — | **C** |

### 1.6 Out of scope / won't do

| # | Item | Source | Class |
|---|---|---|---|
| 37 | Licensing / activation, auto-update, cloud | #3, #4, D4; SPEC §2.4 | **D** (seams kept) |
| 38 | Backup encryption, LAN use, HTTPS behind a proxy | #7, #8, #20 (owner: not in v1) | **D** |
| 39 | Pre-B1 databases | #17 (no customer install exists) | **D** |
| 40 | Row «⋮» menu reads the case on open | S9 (only if it feels slow) | **D** |
| 41 | Typo-tolerant search / `pg_trgm` | S17, #15 (decided) | **D** |
| 42 | Shared idempotency key table across `payments` / `outgoing_payments` | S20 (accepted gap) | **D** |
| 43 | Separate «إلغاء دفعة» page | B3 D6, B4b X6 (owner decision) | **D** |

**Counts:** A = 18 (B5: 13, B5b: 5) · B = 10 · C = 8 · D = 7 · total 43.

## 2. Split: B5 then B5b

The A items are too many for one reviewable branch: B5's money path (delivery + payment in one transaction) and the feed are each L; screen quality work (sideways scroll on four lists, code splitting) touches nearly every page and would drown the money diff.

- **B5 (this branch, first):** items 1–13. Roadmap B5, the S21/S22 debts it owes, and the test hygiene that makes its own Playwright runs trustworthy (items 9–13 come first so B5 is tested on a stable suite). Gates in §10.
- **B5b (own branch, after B5 is merged):** items 14–18. No migration, one small read endpoint (audit feed) and one for shade usage; mostly web. Gates: lint, typecheck, i18n, rtl, unit, web tests, build, `contract:check`, `test:e2e:web` with a 390 px layout check on every list route and axe at 390 px, bundle size before/after in the report.

**Do B5 first.** It is the roadmap slice, S21 depends on it, and B5b's audit feed and layout checks are easier to judge once the bell and delivery dialog exist on the screens they will touch.

---

## 3. Cheque status transitions (SPEC §7.4): check, don't rebuild

Built in B3 (incoming) and B4b (outgoing). B5 writes a traceability table (rule → code → test) into this plan's build notes and adds only the missing tests.

| Rule | Code | Test today (to confirm in stage 0) |
|---|---|---|
| Incoming cheque counts only when cleared; pending shown apart; returned never counts | `isCounted`, `COUNTED_SQL` | `payment-rules.spec.ts`, matrix in `payments-schema.spec.ts` |
| Outgoing cheque counts as an expense only when cleared | `OUT_COUNTED_SQL`, `outCountedWhere` | `outgoing-schema.spec.ts` |
| Cash and transfer count at once | `isCounted` | same matrix |
| `pending → cleared | returned`, `cleared → returned`, `returned` final, no revert | `TRANSITIONS`, `canChequeMove` | `payment-rules.spec.ts`; e2e `invalid_transition` per direction |
| No change on a void payment's cheque | `ChequesService` (`error.cheque.payment_void`) | e2e, both directions |
| Returned incoming cheque restores the doctor's debt; returned refund cheque gives credit back | ledger reads | B4 tie-out + R4 |
| Status date ≤ lab today, ≥ payment date | `cheques.service.ts:55`, `:99` | e2e |
| **Gap (item 6):** status date ≥ the date of the previous status | not checked | add: `error.cheque.date_invalid` when `statusDate < current status_date`; test "cleared 11-10 then returned 11-05 → 400" both directions; statement order test |
| Audit and `cheque_status_history` on every change, same transaction | both services | confirm a test asserts the history row for outgoing too |

If stage 0 finds another rule without a test, the test is added in B5; a behaviour change beyond item 6 goes to the owner first.

## 4. Delivery flow (SPEC §5.7, §9)

### 4.1 Statuses and who may deliver
- Unchanged machine (B2): `waiting | design | in_progress | ready → delivered`; `returned → delivered`; `delivered → returned` only.
- **Every delivery goes through one endpoint, `POST /cases/{id}/delivery`** (decision N3). `PATCH /cases/{id}/status` with `to = delivered` answers `409 error.case.delivery_required`; `allowedStatuses` still lists `delivered`, and the web opens the delivery dialog for it (details page and row menu).
- Already delivered → `409 error.case.already_delivered` («هذه الحالة مسلّمة بالفعل.»). Cancelled → existing `error.case.cancelled`.
- Permissions: `cases.write`; when money is taken also `payments.write`; the dialog's figures need `ledger.read` (without it the dialog offers only "deliver" with a date and a note).

### 4.2 What the dialog asks and what the server does (one transaction)
1. `deliveredDate` (default lab today; ≥ received, ≤ today — existing rule).
2. «هل استلمت المبلغ؟» — `received: full | partial | none`. The question is skipped when the amount due at delivery is 0 («الحالة مدفوعة بالكامل»).
   - **Amount due at delivery** (`deliveryDue`, from the server) = `max(0, remaining − pending cheques bound to this case)` (decision N1). `remaining` is the B3 `allocate()` figure; pending bound cheques are subtracted so "full" never asks twice for money already handed over as a cheque, and so it never exceeds the bound-payment limit (`boundRoom`).
   - **full** → an incoming payment **bound to the case** for exactly `deliveryDue` (the client sends no amount).
   - **partial** → `amount`, `0 < amount < deliveryDue` (equal = full); above → `409 error.delivery.exceeds_remaining {max}` («المبلغ أكبر من المتبقي على الحالة.»); then a collect date.
   - **none** → a collect date.
   - Method cash / transfer / cheque (+ cheque fields), as the advance (decision N4). A cheque payment is pending until it clears; it is still a "payment at delivery".
3. `collectOn` (decision N2): required for partial and none, `≥ deliveredDate`; refused for full (`error.delivery.collect_on_not_allowed`).
4. `note` (optional, ≤ 300, into the status history).

Server order (ADR-0010 lock order): currency SHARE (only with a payment) → doctor `FOR NO KEY UPDATE` → case `FOR UPDATE` + `rowVersion` → re-compute `deliveryDue` under the locks → status, `delivered_date`, `collect_on`, history row → payment insert → `payment_in_no` counter → cheque row → audit `case.delivered` `{caseNo, from, deliveredDate, received, collectOn?}` and `payment.created` `{…, viaDelivery: true}`. Any failure rolls back everything, including both numbers. `Idempotency-Key` required when a payment is taken (same rules as `POST /payments`: replay 200, other body 422, key used on another table 422).

### 4.3 Money and cheques on delivery, return and cancel
| Event | Money | Cheques | Case fields |
|---|---|---|---|
| Deliver, full / partial | one new incoming payment bound to the case; counted at once (cash, transfer) or when cleared (cheque) | a pending cheque if method = cheque; it enters the register and the feed | `delivered_date`, `collect_on` (partial only) |
| Deliver, none | nothing | nothing | `delivered_date`, `collect_on` |
| `delivered → returned` | nothing changes (SPEC §9) | nothing | `delivered_date` and `collect_on` cleared (history keeps the delivery date; audit keeps the collect date) |
| Re-delivery from returned | the dialog asks again with today's `deliveryDue` | — | set again |
| Cancel from returned (D2) | bound payments become account credit (unchanged) | unchanged | `collect_on` already null |
| Fully paid later | nothing | — | `collect_on` stays (history); the collect notification stops because `remaining = 0` |

Changing the collect date later: `PATCH /cases/{id}/collect-on {rowVersion, collectOn | null}`, only while delivered, `≥ delivered_date`, audit `case.collect_on_changed`. Invoices (B6) are not touched by delivery or return (SPEC §9).

## 5. Notifications feed (SPEC §5.16, S21)

### 5.1 Events (generated at read time, never stored)
| Type | Condition (lab today `T`) | Phases | Permission | Opens |
|---|---|---|---|---|
| `case_due` | status in waiting / design / in_progress / ready / returned, `expected_date ≤ T + 2` | `soon` (T…T+2), `overdue` (< T) | `cases.read` | case details |
| `cheque_in_due` | incoming pending cheque of an active payment, `due_date ≤ T + 7` (`dueState`) | `soon`, `overdue` | `cheques.read` | register `?direction=in&due=…&q=<cheque no>` |
| `cheque_out_due` (S21) | outgoing pending cheque, same rule | `soon`, `overdue` | `cheques.read` + `expenses.read` | register `?direction=out…` |
| `collect_due` | delivered case, `collect_on ≤ T`, `remaining > 0` | `due` | `cases.read` + `ledger.read` | case details |

Items carry codes and params plus a `text` rendered from the API catalogs in the request language (SPEC §6.1: notification texts are localized by the API). Patient names come from the live case (as in the cases list); nothing is copied into a table or the log.

### 5.2 Read, unread, dismissed (decisions N5–N7)
- **Key** = `type:entityId:phase:date` (date = expected date, due date or collect date). A dismissed "soon" comes back as "overdue"; a changed date gives a new key.
- **Unread** = not yet seen. Opening the bell panel marks the shown items seen; the badge counts unread items. **Dismiss** hides an item until its key changes. A "mark all as read" action.
- State is **per user** (`user_id` in the key of the state table): one owner today, ready for more roles (SPEC §3.3).
- **Retention:** state rows whose key is no longer generated are purged when older than 180 days, during any state write (no scheduler).

### 5.3 Performance
- One read = four grouped statements in one snapshot: cases by `cases_status_expected_ix`; incoming and outgoing cheques by `cheques_status_due_ix`; collect cases by a new partial index `(collect_on) WHERE collect_on IS NOT NULL` → `doctorInputs(ids)` + `allocate` for those doctors only (the existing fixed-statement path); one lookup of the user's state rows for the generated keys.
- `GET /notifications/count` uses the same queries with counts only, polled every 60 s while the window is visible (TanStack `refetchInterval`, paused when hidden) and invalidated by `refreshMoney` and case writes.
- Limit 20 items per type in the list, `total` per type exact.
- Target at 20 000 cases / 50 000 payments / 10 000 outgoing: `count` p95 ≤ 50 ms, list p95 ≤ 100 ms; asserted structurally (statement count, `EXPLAIN` uses the indexes), timings reported.

## 6. Data model and migration outline (`0008_delivery_notifications.sql`)

All expand-only; no data rewrite.
- `cases.collect_on date NULL`; CHECK `cases_collect_on_ck`: `collect_on IS NULL OR (status = 'delivered' AND collect_on >= delivered_date)`. Every existing row has it null, so the CHECK holds (asserted by the migration test).
- Index `cases_collect_on_ix (collect_on) WHERE collect_on IS NOT NULL`.
- Table `notification_states`: `user_id bigint NOT NULL → users ON DELETE CASCADE` (not financial data), `key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 100)`, `seen_at timestamptz NULL`, `dismissed_at timestamptz NULL`, `created_at timestamptz NOT NULL default now()`, PK `(user_id, key)`. Replaces SPEC §8 `dismissed_notifications(key)` (adds the user and "seen").
- Permission `notifications.read` granted to `owner` (hand-written block, like 0005/0007).
- No new counter (delivery payments use `payment_in_no`).
- Drizzle schema + `db:generate --name delivery_notifications`, SQL reviewed, permission block appended.
- Tests: empty DB → 0008; DB at 0007 with the B4b demo → 0008 (rows untouched, CHECK valid, permission granted).
- SPEC edits after approval: §8 (`collect_on` rule, `notification_states`), §5.7 (`deliveryDue`, N1–N4), §5.16 (phases, per-user state), §11 B5 row.

## 7. API (`/api/v1`, Bearer, DTO-validated, unknown fields rejected, error envelope with stable codes in ar/en)

| # | Method + path | Permission | Request → response | Errors (beyond 400/401/403) |
|---|---|---|---|---|
| 1 | `POST /cases/{id}/delivery` (+ `Idempotency-Key` when paying) | cases.write (+ payments.write when paying) | `{rowVersion, deliveredDate?, note?, received: full|partial|none, amount?, method?, paidAt?, cheque?, collectOn?}` → 200 `{case: CaseDetail, payment: PaymentResponse|null, doctorBalance|null}`; replay 200 + `Idempotent-Replayed` | 404; 409 `case.already_delivered`, `case.invalid_transition`, `delivery.exceeds_remaining {max}`, `cheque.duplicate`, `concurrency.stale`; 400 `delivery.amount_required`, `delivery.collect_on_required`, `delivery.collect_on_invalid`, `delivery.collect_on_not_allowed`, `case.delivered_date_invalid`, `payment.cheque_required/not_allowed`, `idempotency.required`; 422 `idempotency.mismatch` |
| 2 | `PATCH /cases/{id}/collect-on` | cases.write | `{rowVersion, collectOn|null}` → `CaseDetail` | 409 `case.not_delivered`, `concurrency.stale`; 400 `delivery.collect_on_invalid` |
| 3 | `GET /cases/{id}` (additive) | cases.read (+ ledger.read) | `+ collectOn, deliveryDue|null` | — |
| 4 | `PATCH /cases/{id}/status` (changed) | cases.write | `to = delivered` refused | 409 `case.delivery_required` |
| 5 | `GET /notifications` | notifications.read (+ per type) | `?limit` (≤ 50) → `{today, counts:{unread, total, byType}, groups:[{type, total, items:[{key, type, phase, date, entity:{kind, id}, params, text, seen}]}]}` | — |
| 6 | `GET /notifications/count` | notifications.read | → `{unread, total}` | — |
| 7 | `PATCH /notifications/state` | notifications.read | `{keys: string[1..200], seen?: true, dismissed?: boolean}` → 204; keys not generated for this user right now are ignored | — |
| 8 | `GET /cheques`, `GET /cheques/summary` | — | **removed** (S22) | 404 |
| 9 | `PATCH /cheques/{id}/status`, `PATCH /outgoing-cheques/{id}/status` (changed) | as B3/B4b | status date also ≥ the current status date (item 6) | 400 `cheque.date_invalid` |

New catalog keys (API, ar + en): `error.delivery.*`, `error.case.already_delivered`, `error.case.delivery_required`, `error.case.not_delivered`, `notification.*` (texts per type and phase), `audit.case.delivered`, `audit.case.collect_on_changed`. `openapi:export` + `api:generate` committed; `contract:check` clean.

## 8. Frontend screens (stage 2; skills `smile-artec-web-*`, `frontend-design` for the bell panel)

- **`DeliveryDialog`** (`features/cases/`): opened by choosing «تم التسليم» in the status dialog or the row menu. Date (`DateField`), the three-way question as a radio group (only when `deliveryDue > 0`), amount (`MoneyField`, partial only, max shown and enforced only as guidance), method radios + `ChequeFields` (reused from payments), collect date (partial / none), note. Shows `deliveryDue` and pending cheques as a memo. One `Idempotency-Key` per attempt. Toast «تم تسليم الحالة» (+ voucher and new balance when paid). `refreshMoney()` + case invalidation. Server messages in the form alert.
- **Case details:** «موعد تحصيل الباقي» in the header with an edit action (`ActionButton`, disabled with a reason when not delivered); «تحصيل مستحق» marker (text + icon, not colour alone).
- **Bell** in the top bar (SPEC §4): icon button named «الإشعارات» + unread count («3 غير مقروءة», plural forms); a Radix popover panel grouped by type with headings and counts, each item a link plus a «إخفاء» button; «تحديد الكل كمقروء»; «عرض الكل» per group links to the existing filtered list (`/cases?overdue=1`, `/cheques?due=soon&direction=in`); empty state «لا توجد إشعارات»; error state with retry inside the panel. Esc closes and returns focus to the bell. Polling does not announce (no live region on the badge; the count is in the button's name).
- **Removed nothing visible**; the register already uses `/cheques/register` (S22 is backend only, plus the regenerated client).
- Every string in `ar.json` + `en.json`, logical CSS only, `dir="auto"` for names, one `h1`, focus returns to the trigger.

## 9. Test plan

**Unit (pure):** `deliveryDue` (remaining, pending bound cheques, cancelled, opening balance, overpayment → 0); delivery decision table (full / partial / none × due 0 / > 0 × each method); collect-date rules; notification phase function per type with `T` around month and year ends; key builder (phase and date change → new key); cheque `status_date` ≥ previous status date.
**Integration (Testcontainers PostgreSQL 16):** migration 0008 on empty and on 0007 + data; `cases_collect_on_ck` rejects collect without delivery and before the delivery date; notification queries equal the pure phase function over a generated matrix; `EXPLAIN` uses `cases_status_expected_ix`, `cheques_status_due_ix`, `cases_collect_on_ix`; **concurrency:** delivery with payment vs a parallel `POST /payments` bound to the same case (bound limit never exceeded), vs a case edit (one 409), vs a currency change; parallel deliveries of one case (one wins, one `already_delivered`); same idempotency key twice (one row); a forced failure after the voucher number → no case change, number reused.
**API e2e (Supertest):** 401/403 per route, including feed types hidden without their permission (`cheque_out_due` without `expenses.read`, `collect_due` without `ledger.read`); every new error code in ar and en; delivery full / partial / none with hand-calculated balances, statement and breakdown after each (the B4 tie-out stays green for every demo doctor); `PATCH status → delivered` refused; return clears `collect_on`; feed contents and counts against seeded dates; seen / dismiss / phase change brings an item back; state of user A invisible to user B; `GET /cheques` and `/cheques/summary` answer 404; `TZ=UTC` with a non-UTC lab zone (identical feed around midnight).
**Web unit/component (Vitest):** `DeliveryDialog` (question hidden at due 0, partial max, cheque fields, collect date required, Arabic inline errors, server errors, key reuse on retry, double click sends once), bell (count in the name, panel groups, dismiss, mark all read, error state, focus return), i18n parity, RTL guard.
**E2E (Playwright + axe, ar and en, `TZ=UTC`, each test seeds its own data with `uid()` names):** deliver with part payment and a collect date → case page and doctor statement; deliver with a cheque → the register and the bell show it; deliver with nothing, collect date today → «تحصيل مستحق» in the bell; dismiss and mark read; return and re-deliver; `expectAccessible` with the dialog and the panel open, and at 390 px for these two; screenshots in both languages. `first-run.spec.ts` language fix and the payment-locks-currency test (item 10: the first amount in that file becomes an unbound incoming payment to a new doctor; the price lock stays covered by the API e2e). Every run uses a throwaway `*_e2e` database.
**Contract drift:** `npm run contract:check`.

**Demo seed additions (`scripts/demo`, through the API only):** cases due tomorrow and overdue; delivered cases paid in full at delivery, part paid with a collect date in the past (due) and in the future, unpaid with a collect date today; one delivered by cheque still pending; existing incoming / outgoing cheques already give due and overdue items. `demo-seed.spec.ts` and `home-demo.spec.ts` updated in the same commit; the tie-out test runs with them.

## 10. Order and gates (one branch)

**Stage 0 — checks, no product code (≈ ½ day):**
1. Test hygiene first (items 9, 11, 12, 13) as separate test-only commits: language-save wait; `expect.poll` instead of the sleep; `NewCasePage.test.tsx` measured under `--maxWorkers` load, the slow step fixed (likely typing through `userEvent` per character) or, if it is honest work, a per-file timeout with a comment; the Vitest path issue reproduced and fixed if a config change does it (normalised `root`), otherwise documented in CLAUDE.md "Commands" and the testing skill.
2. Item 6 confirmed by a failing test (both directions); the §3 table filled with real test names.
3. Notification queries and their `EXPLAIN` on the large dataset; bundle size recorded as the B5b baseline.

**Stage 1 — backend, one logical change per commit:** (1) pure rules (`deliveryDue`, phases, keys, cheque date) + tests; (2) migration 0008 + schema + migration tests; (3) delivery endpoint + collect-on + the status-endpoint change; (4) cheque status-date rule; (5) notifications read + state; (6) S22 removal; (7) OpenAPI, client, catalogs, demo seed, the S13 hook note.
**Gate 1** (real output reported): lint, typecheck, i18n:check, unit, integration, API e2e (tie-out included), build, contract:check.

**Stage 2 — web:** delivery dialog, case-details collect date, bell; catalogs; component tests; Playwright + axe + screenshots; item 10.
**Gate 2:** Gate 1 + web tests (from PowerShell until item 13 is fixed), rtl:check, `test:e2e:web` (ar + en, `TZ=UTC`, all four projects).
**Docs in the last commit:** SPEC edits (§6), production-readiness (S21, S22 done; S13 note; new rows if any), skills `money-ledger` (delivery payment, lock order) and `web-api-data` / `web-testing-a11y` (delivery dialog, bell, language-save wait), this plan's build notes. No push; PR only after the owner's go-ahead.

## 11. Risks

1. **A second path that creates incoming payments** (delivery). Mitigation: it calls the same payment creation code inside the same transaction (no copy), same lock order, idempotency and audit; the tie-out test covers demo doctors delivered with payments.
2. **`deliveryDue` vs the bound limit** with pending cheques — N1 makes them agree by construction; tested on the boundary.
3. **Contract change** of `PATCH /cases/{id}/status` (delivered refused) — existing B2/F2 tests and the status dialog change in the same branch.
4. **Feed cost on every page** (bell polling) — count endpoint, indexes, 60 s and paused when hidden; measured.
5. **Midnight and time zone** — phases use the lab's today; tests with `TZ=UTC` and a non-UTC lab zone.
6. **Notification keys** that change unexpectedly would bring back dismissed items — keys built by one tested function.
7. **Removing two endpoints** (S22) — nothing in this repo calls them (checked with `contract:check` and a search); single-install product with no outside clients.
8. **Scope creep** — screen-quality work stays in B5b; invoices stay in B6.

## 12. Needs owner decision (each has a recommended default; approving the plan without comment = defaults)

| # | Question | Default (recommended) | Alternative |
|---|---|---|---|
| **N1** | Amount due at delivery when a cheque for this case is still pending. | Remaining minus pending cheques bound to the case («full» asks only for what is not covered yet). | The full remaining, ignoring pending cheques (may be refused by the bound limit). |
| **N2** | Collect date for a part payment or no payment. | Required, on or after the delivery date; can be changed later; cleared if the case is returned. | Optional. |
| N3 | Delivery only through the dialog. | Yes: the status change to «تم التسليم» always opens the dialog; the API refuses a plain status change to delivered. | Keep a plain status change too (no money question). |
| N4 | Payment methods at delivery. | Cash, transfer, cheque (as the advance and «دفعة واردة»). | Cash only. |
| N5 | Which cases appear as due. | Every case still in the lab (waiting, design, in progress, ready, returned) with expected date within 2 days or passed. | Only «جاهزة للتسليم». |
| N6 | Read vs hidden. | Opening the bell marks items read (badge = unread); «إخفاء» hides an item until it becomes overdue or its date changes. | Hide only (SPEC literal); badge = everything not hidden. |
| N7 | Whose notification state. | Per user (one owner now). | Per installation. |
| N8 | Keep hidden/read marks. | 180 days after the item stops appearing. | Forever. |
| **N9** | Split. | B5 (items 1–13) now; B5b (items 14–18) next, own branch. | One branch with everything. |
| N10 | First-run browser test for the currency lock. | The first amount in `first-run.spec.ts` becomes an incoming payment; the price lock stays tested in the API e2e. | A fifth Playwright project (another empty installation) for the payment case. |

Still waiting on Ibrahim (class C, item 29): D2, D3, D9 (B3) and X1, X2, X3 (B4b).

---

## 13. Build notes (2026-11-20)

Owner conditions with the approval: (1) the cheque returned-date gap proven by a failing test first, then fixed, and covered by the tie-out / statement tests; (2) N3 applied everywhere (tests, OpenAPI, demo seed, docs), internal paths still working and tested; (3) Ibrahim's pending sign-offs and two new questions recorded in `docs/production-readiness.md`. All three are done; details below.

### 13.1 Order of the commits
1. Test hygiene (items 9, 11, 12, 13): Vitest from any shell (`scripts/vitest.ts`), timeouts for heavy screens, `expect.poll` instead of the 150 ms sleep (the chart test now also seeds its own work type: it failed when run alone), `switchLanguage` in `e2e/support.ts` used by both first-run files, the first-run currency lock now caused by an incoming payment (item 10).
2. Item 6: the failing tests committed on their own (`test(api): … (failing)`: outgoing `expected 400, got 200`, incoming the same), then the fix `chequeStatusDateValid` with a tie-out test over every demo doctor and an early return on a demo cheque, then a test reading the `cheque_status_history` rows in both directions (the §7.4 check found none).
3. Migration 0008, pure rules, delivery endpoint + collect date + the status-endpoint refusal (with the demo seed and every existing test moved), notifications feed, S22 removal, the S13 note, `collectDue`, `all: true` for opening the bell.
4. Web: delivery dialog, collect-date dialog, «تحصيل مستحق» marker, bell; component tests; Playwright `e2e/delivery.spec.ts`; the case-actions test delivers through the dialog.
5. Docs (this section, SPEC §5.7 / §5.16 / §8 / §11, production-readiness, skills).

### 13.2 SPEC §7.4 traceability (rule → code → test)
| Rule | Code | Tests |
|---|---|---|
| Incoming cheque counts only when cleared; pending apart; returned never | `isCounted`, `COUNTED_SQL` | `payment-rules.spec.ts`, `payments-schema.spec.ts` matrix |
| Outgoing cheque counts only when cleared | `OUT_COUNTED_SQL` | `outgoing-schema.spec.ts` |
| `pending → cleared / returned`, `cleared → returned`, `returned` final | `TRANSITIONS`, `canChequeMove` | `payment-rules.spec.ts` (all 9 pairs); e2e `invalid_transition` in `payments.e2e` (plan example 1) and `outgoing.e2e` ("status rules") |
| No change on a void payment's cheque | `ChequesService` | `payments.e2e` "voids a cleared cheque (D9) and then freezes its status", `outgoing.e2e` "a voided outgoing cheque is frozen" |
| Returned cheque restores the debt / the refund credit | ledger reads | `payments.e2e` plan example 1, `outgoing.e2e` R3, `ledger-tieout.e2e` |
| Status date ≤ today, ≥ payment date | `chequeStatusDateValid` | `payment-rules.spec.ts` table, `payments.e2e` "dates are validated", `outgoing.e2e` "status rules" |
| **Status date ≥ the current status date (new, item 6)** | `chequeStatusDateValid` | `payment-rules.spec.ts`; `payments.e2e` and `outgoing.e2e` "a status date may not be earlier than the current status date"; `ledger-tieout.e2e` "B5 item 6" |
| History row and audit on every change, same transaction | both services | the two item-6 e2e tests read `cheque_status_history`; audit in plan example 1 |

### 13.3 Endpoints (as built)
| Method + path | Change |
|---|---|
| `POST /cases/{id}/delivery` | new (cases.write; payments.write + Idempotency-Key when received full / partial) |
| `PATCH /cases/{id}/collect-on` | new (cases.write) |
| `GET /cases/{id}` | + `collectOn`, `pendingCheques`, `deliveryDue`, `collectDue` |
| `GET /cases` | + `collectOn` on each item |
| `POST /cases/{id}/status` | `to = delivered` → 409 `error.case.delivery_required` (or `already_delivered`); a return clears the collect date |
| `GET /notifications`, `GET /notifications/count`, `PATCH /notifications/state` | new (notifications.read; each type also needs its own read permission) |
| `PATCH /cheques/{id}/status`, `PATCH /outgoing-cheques/{id}/status` | status date ≥ the current status date |
| `GET /cheques`, `GET /cheques/summary` | removed (S22) |

### 13.4 Measured (dev machine, 20 000 cases / 50 000 payments / 10 000 outgoing, `notifications-scale.spec.ts`)
- Statements per request, fixed whatever the data: `count` 14, feed 15.
- `GET /notifications/count` with cases only: p95 45 ms; incoming cheques only 23 ms; both cheque directions 38 ms.
- Whole feed (with «تحصيل مستحق», ≈470 collect dates over nearly all 500 doctors): `count` p95 ≈ 260 ms, list p95 ≈ 290 ms; after moving all but 60 in-lab cases into the future ("normal backlog"): 239 / 279 ms. The 50 ms / 100 ms targets of §5.3 are met for cases and cheques, **not** for the collect reminder (it runs `allocate` for every owing doctor with a collect date reached); recorded as production-readiness S23.
- Web bundle after B5 (B5b baseline): 1,182 KB, 341 KB gzip, one chunk.

## 14. Decisions taken while unattended

Safest default from this plan each time; each is easy to change.

1. **Status endpoint name.** The plan said `PATCH /cases/{id}/status`; the existing route is `POST /cases/{id}/status`. The N3 refusal is on that route.
2. **Who sees `deliveryDue`.** Returned with `cases.read`, like `paid` / `remaining` already are on the case details (the plan said "+ ledger.read"); no figure is exposed that was not already there.
3. **Part payment equal to the amount due** → 400 `error.delivery.partial_equals_due` («اختر المبلغ كاملًا») instead of silently treating it as full.
4. **Nothing due any more** (another payment arrived while the dialog was open) with `partial` / `none` → 409 `error.delivery.nothing_due`; with `full` or no answer the case is delivered without a payment.
5. **Payment date at delivery** = the delivery date (no separate field).
6. **Audit.** Delivery writes `case.delivered` {caseNo, from, deliveredDate, received, collectOn?} (not `case.status_changed`); a return writes the cleared collect date in its `case.status_changed` entry; `payment.created` carries `viaDelivery: true`.
7. **Opening the bell marks the whole feed read** (`PATCH /notifications/state {all: true, seen: true}`), not only the 20 items listed per type, so the badge can reach zero; therefore no separate «تحديد الكل كمقروء» button. Hidden items cannot be shown again from the screen (the API accepts `dismissed: false`). Recorded as S24.
8. **«عرض في القائمة»** per group: cases → `/cases?overdue=1`, cheques → the register with direction and `due=soon`, collect → `/debts`.
9. **Retention (N8)** is applied to marks created more than 180 days ago whose item is no longer in the feed, purged during any state write.
10. **`collectDue` on the case details** (added, contract first) so the page never decides «تحصيل مستحق» itself.
11. **Without `payments.write`** the delivery dialog offers only «لا، لم أستلم شيئًا»; the bell is hidden without `notifications.read`.
12. **Item 12** became one config change (Vitest `testTimeout` 15 s, Testing Library `asyncUtilTimeout` 4 s): three files timed out under a parallel run, not only NewCasePage, and the slow parts are real renders.
13. **Item 13** was fixed, not only documented: the cause is a lower-case drive letter in the working directory; `npm test` now normalises it.
14. **Demo seed.** Delivered cases go through the delivery endpoint in turn: full (one by a cheque still pending), part with a collect date already reached or later, nothing with a collect date today or past; the payment is dated on the delivery date (before: "today"), so the demo's "received this month" differs from B4b. `home-demo.spec.ts` compares with the API; the tie-out test asserts the three kinds exist.
15. **The B3 migration test** now ignores the 0008 `collect_on` column as it ignored the 0006 search column, and asserts it is empty on every old case.
16. **First-run currency test.** The price lock is no longer shown in the browser; it stays covered by `settings.e2e.spec.ts` (each source of an amount) — N10.
