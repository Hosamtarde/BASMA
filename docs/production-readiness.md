# Production readiness — pre-production tasks (not in v1)

Items to decide or build before selling the product to other labs (SPEC §2.4). Updated as milestones progress.

| # | Task | Notes |
|---|---|---|
| 1 | Product name «Basma» (بسمة) | Name decided (`PRODUCT_NAME` + `app.productName`); still check trademark and domain before sale |
| 2 | Code signing | Sign the installer and binaries (avoids SmartScreen warnings) |
| 3 | Licensing / activation | Implement behind the `LicenseService` seam (ADR-0013); subscription model to be decided |
| 4 | Update distribution | v1 = manual installer upgrade; later signed update packages + in-app update check |
| 5 | Installer branding | Product logo, splash, EULA text, «Powered by Smile Artec Dental Laboratory» on splash/login only |
| 6 | Support / diagnostics bundle | Export logs + versions + backup status (no patient data, no secrets) |
| 7 | Backup encryption | Not in v1 (owner, 2026-11-06); password-protected backups to reconsider before selling |
| 8 | Multi-computer / LAN use | Not in v1 (one computer per install); needs TLS + firewall rule + auth review if added |
| 9 | Third-party licences | Notices for Node.js, PostgreSQL, WinSW, Cairo (OFL) and npm dependencies shipped |
| 10 | Clean-VM test matrix | Windows 10/11, install → upgrade → restore → uninstall-keeps-data |
| 11 | Access token after password change | Stays valid up to 15 min (refresh tokens are revoked at once). Add a per-user token version if this matters |
| 12 | Lockout as denial of service | Anyone who can reach the API can lock the owner for 15 min. Acceptable while bound to 127.0.0.1; revisit with LAN use (#8) |
| 13 | Rate-limit store | In-memory, per process. Fine for one service; revisit if several API processes ever run |
| 14 | "Money exists" check grows per milestone | `SettingsRepository.hasMoneyData` covers work-type prices, opening balances, special prices (B1) and any case (B2); B3 added payments, B4b added outgoing payments (done, tested on a fresh install); **B6 added invoices (done):** a first free invoice alone locks the currency (`invoice-numbering.e2e.spec.ts`) |
| 15 | Search speed | **Decided in B4: no `pg_trgm`, no trigram index.** Stage-0 measurement at 20 000 cases / 50 000 payments / 500 doctors: the folded `ILIKE` search had p95 143 ms (a text matching half of the cases) and 230 ms (two-word "closest" tiers), above the 100 ms gate, because `translate(lower(…))` ran on every row (~50 ms per scan of the cases). Migration 0006 adds two **generated stored columns** (`cases.patient_search`, `doctors.search_text`: the folded text, computed once per write): p95 is now 11–26 ms for every search shape. A trigram index would add little (measured: no-match scan 4.6 ms → 0.9 ms) and would make `pg_trgm` an installer dependency; revisit with the B8 load test or if typo-tolerant search is wanted |
| 16 | Logo in the browser | Done in F0: fetched as a blob and shown through an object URL that is revoked on change/unmount |
| 17 | Pre-B1 databases | A database set up with the B0 first run has no settings and no expense categories. No customer install exists yet; developers reset their dev DB (`docker compose down -v`) |
| 18 | Cancel from "returned" (decided in B3 as D2, pending sign-off below) | Not allowed in B2. Decide in B3, once payments exist, whether a returned case may be cancelled and what happens to its payments (owner, B2) |
| 19 | Case search by patient | Contains-search on patient names returns personal data to any user with `cases.read`; fine with one owner, review when more roles exist |
| 20 | HTTPS / reverse proxy | The refresh cookie gets `Secure` from `req.secure`. Behind a TLS proxy (cloud, LAN #8) set Express `trust proxy`, enable HSTS (off on loopback http, ADR-0017) and review the loopback-only `API_HOST` rule |
| 21 | Web bundle size | One chunk loaded from the local disk: 733 KB (229 KB gzip) in F0, 1,000 KB (302 KB gzip) after F2 (cases screens, cmdk, react-day-picker with date-fns; only the ar/en calendar locales are bundled), 1,030 KB (310 KB gzip) after F2b (Home, row actions; no new package). Split by route (React Router `lazy`) if start-up gets slow. **B5b baseline (measured after B5):** 1,182 KB (341 KB gzip), one chunk. **After B6:** entry 270.6 kB (84.5 kB gzip), all JavaScript 1,291 kB in route chunks; the invoice screens are their own chunks (renderer 12.7 kB + 4.3 kB CSS) |
| 22 | **Restore with immutable invoices (rule for B7)** | Issued invoices are protected by triggers that refuse UPDATE (except the one-way void) and DELETE on `invoices`, `invoice_cases` and `document_images` (B6, migration 0009). INSERT is not guarded, so a backup restores cleanly **into a fresh, empty database** with `pg_restore` (custom format) or `psql -v ON_ERROR_STOP=1` (plain SQL) — tested in `invoice-backup-restore.e2e.spec.ts` with issued, voided and numbered invoices and a frozen logo: rows, snapshots, SHA-256 checks, counters and the triggers themselves come back identical, and the API on the restored database continues the numbering. **B7 must:** restore into a new database and switch over (never a data-only restore into the live schema, never `--disable-triggers`, never row deletes to "clean" a database — drop and recreate it); after a restore, read every invoice once (the API verifies each hash) and refuse the restore if one fails; never write a migration that rewrites issued snapshots (a new snapshot shape gets a new `snapshot_version`, old ones still render). TRUNCATE is not guarded (only an administrator can run it); the e2e reset drops schemas |
| 23 | Parallel reads inside one transaction | **Done in B6b:** `readAll(db, [...])` (`shared/db/read-all.ts`) runs the reads of `LedgerRepository.doctorInputs` and `statement` one after the other inside a transaction and in parallel on the pool; test `ledger-tx-reads.spec.ts` counts overlapping queries (5 before, 0 after). Other `Promise.all` reads take the pool, not a transaction, and stay parallel |

| 24 | Snapshot size (B6b measurement, input for B8) | A 200-case invoice (3 teeth per case, Arabic names): snapshot 96,067 bytes as text, 4,583 bytes stored (compressed jsonb), response 88,424 bytes, issue 95 ms, GET 10 ms. A 2,000-line statement (1,000 cases + 1,000 payments): 443,266 bytes as text, 26,577 stored, response 399,597 bytes, issue 164 ms, GET 32 ms. Both far under the 1 MB cap: no change needed (`invoice-snapshot-size.e2e.spec.ts`) |
| 25 | Statement order bug found in B6b | Same-day items of one kind were paged in text order of the id (10 before 9) while the running balance used numeric order; issuing that statement failed its own check (500). Fixed: `ORDER BY run.date, run.ord, run.ref_id`; test `statement-order.e2e.spec.ts` |

## Open decisions — editions (`docs/editions.md`, ADR-0018)

| # | Decision | Notes |
|---|---|---|
| D1 | Final product name | Decided: «Basma» (بسمة) for the `generic` edition; trademark/domain check still open (same item as #1) |
| D2 | Licensing terms for resale | What a buying lab may do (installs per licence, term, support, transfer) |
| D3 | Written ownership / resale agreement with Ibrahim Al-Tarda | Who owns the code and the `generic` edition, and the right to resell it; needed before the first sale |
| D4 | Licence-key or activation approach | Deferred; implement behind the `LicenseService` seam (ADR-0013, same item as #3) |

## Follow-ups from the vertical slices

| # | Slice | Item | Notes |
|---|---|---|---|
| S1 | Home | Pipeline strip and status donut need a count per status | **Done (F2b):** `GET /cases/summary` returns the count per status, the total and the overdue count in one grouped statement (one snapshot), with the same filters and lab-today overdue rule as the list (except status and paging); permission `cases.read` |
| S2 | Cases | Per-status counts on the case-list chips | **Done (F2b):** the chips and «المتأخرة فقط» show counts from `GET /cases/summary` with the list's other filters (doctor, search, dates, overdue) |
| S3 | Shade guide | «الأكثر استخدامًا» row (SPEC §5.5) | Needs usage counts from the API (e.g. top shades of the last N lines); not built in F2. **Done in B5b:** `GET /cases/shade-usage` (counts per shade over lines of cases that are not cancelled, `cases.read`, bounded) and the row at the top of the shade guide |
| S4 | Add case | Same tooth twice | SPEC default kept: several lines per tooth are allowed without asking (crown + abutment); a "replace or add" question can be added if the owner wants it |
| S5 | Tooth chart | Work-type colours | The chart colours work types from a fixed palette in order of first use on the case (no colour field in the API). A colour per work type would need a setting (B-slice) |
| S6 | Tooth chart | Artwork | Our own parametric drawing (`features/cases/chart/geometry.ts`), to be replaced by licensed artwork; only the artwork layer changes (SPEC §1.1) |
| S7 | Home | Action cards for payments, debts, cheques and invoices | **Done for payments, debts and cheques (B3):** the three cards link to their screens with live figures from `GET /ledger/summary` (received this month, owed to the lab, cheques due soon or overdue). «دفعة صادرة» and «إنشاء فاتورة» stay «قريباً» until their slices ship |
| S8 | Home | «الأرقام الرئيسية» and «آخر العمليات» panels of direction A | Key numbers now include received this month, owed to the lab and pending cheques (B3). Expenses and invoices need B6+; the «آخر العمليات» feed (audit log) was not built until B5b. **Done in B5b:** `GET /audit/recent` (settings.read, fixed 20 rows, display-safe fields only) and the Home panel. A dedicated audit permission would need a migration; until then the panel needs settings.read |
| S9 | Cases | Row «⋮» menu reads the case when opened | One GET per menu opening, so the list does not carry allowedStatuses/canCancel for every row. If the menu feels slow, add those fields to the list items (additive API change) |
| S10 | Payments | Outgoing payments, refunds and the separate «إلغاء دفعة» page | **Done in B4b:** outgoing payments and refunds of a doctor's credit exist (`POST /outgoing-payments`) and the screens are built: «دفعة صادرة», «استرداد رصيد» on the doctor page. The separate void page stays out by owner decision (B4b X6): void is a row action on both payment pages |
| S11 | Debts | Breakdown modal and CSV export (SPEC 5.11) | **Done (B4):** a name opens the breakdown dialog (URL `?doctor=`), the statement is one click away in the row; CSV for debts and for the breakdown |
| S12 | Cases | Per-row paid / remaining in the cases list | **Done (B4):** `GET /cases` items carry `paid` and `remaining` (null without `ledger.read`), computed for the doctors on the page in a fixed number of statements (7 per request at any page size) and the existing `allocate()` once per doctor; the doctors list carries the balance the same way |
| S13 | Cancel from returned | «Blocked once invoiced» (SPEC 7.8) | **Done in B6:** a case on an active invoice can be neither edited nor cancelled (also from «مرتجعة»), `error.case.invoiced` with the invoice number; `canEdit` / `canCancel` / `editBlockedReason` come from the API; voiding the invoice lifts the lock (`invoices.e2e.spec.ts` "S13") |
| S14 | Lists | Wide tables at phone width | **Done in B5b:** the table scrolls inside its card (the cause was visually hidden table parts widening the page), and every route is checked at 390 px in both languages with axe (`e2e/responsive.spec.ts`). The sidebar still stacks above the content on a phone; the product runs on a desktop (SPEC §2.1) |
| S15 | Export | CSV opens correctly in Excel with Arabic | Comma delimiter and UTF-8 BOM are tested at the byte level, but Excel's list separator depends on the Windows regional settings. Verify on the owner's computer (steps in `docs/plans/b4-debts-reports-search.md` §2.4) and switch `CSV_DELIMITER` to `;` if a file opens in one column |
| S16 | Export | Row cap and rate limit | 50 000 rows per file and 10 files per user per minute (in memory, one API process, like #13); raise after the B8 load test if needed. Every export is audited without the search text |
| S17 | Search | Letter folding and no typo tolerance | Search folds hamza, ta marbuta, alef maqsura and tashkeel for finding only; stored names are untouched. Multi-word queries fall back to all words, then any word ("closest"). A misspelt word is not corrected (no `pg_trgm`, see #15) |
| S18 | Payments | Outgoing payments, refunds and the expenses report | **Done in B4b (backend and screens):** outgoing payments, OUT- vouchers, outgoing cheques, refunds in the ledger, expenses report and cash summary panels, two CSV buttons, OUT- search group, live Home card. Screenshots: `docs/screenshots/b4b/` |
| S19 | Ledger | A refund no longer covered (B4b X2/X3) | A refund is refused above the doctor's refundable credit, but the credit can shrink later (his cheque bounces, an incoming payment is voided). The uncovered part is then owed on the refund's own line (breakdown, CSV), not silently moved onto old cases. The refund line now shows in the debts breakdown («استرداد للطبيب», with the refunds term in the equation) and in the statement; the owner still has to confirm it reads well (screenshot `docs/screenshots/b4b/breakdown-refund-ar.png`) |
| S20 | Payments | One Idempotency-Key across two tables | `payments` and `outgoing_payments` each have a unique key index; reuse of a key across the two tables is refused by a service check (one indexed lookup), not by a constraint. Two simultaneous first requests with the same key on the two different endpoints could both succeed; harmless (two different requests by design) and a client never does this. A shared key table would close it if ever needed |
| S21 | Notifications | Outgoing cheques due | **Done in B5:** the feed has a `cheque_out_due` group (pending outgoing cheques of active payments due within 7 days or overdue), shown only with `cheques.read` + `expenses.read` |
| S22 | Cheques | Two register endpoints; the B3 pair is now unused | **Done in B5:** `GET /cheques` and `/cheques/summary` are removed with their service, repository code and DTOs (a test asserts 404); the tests that read them read the register's incoming side. `openapi.json` and the client regenerated |
| S23 | Notifications | The collect reminder reads the ledger | Cases and cheques are counted in SQL (B5 scale test, 20 000 cases: `count` p95 45 ms with cases only, 23–38 ms with cheques). «تحصيل مستحق» needs the FIFO figures, so it runs `allocate` for every doctor who still owes and has a case with a collect date reached: in the harsh scale dataset (≈470 collect dates spread over nearly all 500 doctors) the whole `count` is p95 ≈ 260 ms, polled once a minute per open window. A collect date stays on a case after it is paid (history), so the candidates grow with time; only doctors with a positive balance are computed. Options if it matters: a cheaper "still owed" test per case, or caching per ledger change |
| S24 | Notifications | Opening the bell marks everything read | Decided while unattended in B5 (N6): opening the bell marks every item of the feed read, also the ones beyond the 20 listed per type, so the badge counts only what is new. «إخفاء» hides one item until it changes phase or date. There is no screen to show hidden items again (the API supports it) . **Follow-up (B5b, not built):** a screen to show hidden items again, e.g. a «المخفية» section at the end of the bell with «إظهار» per item (the API already takes `dismissed: false`) |
| S25 | Audit | A dedicated `audit.read` permission (B8) | `GET /audit/recent` (B5b) reuses `settings.read` because adding a permission needs a migration. B8 adds `audit.read` (migration + grant to `owner`) and moves the endpoint and the Home «آخر العمليات» panel to it |

## B3 defaults pending owner sign-off (Ibrahim)

Implemented as the plan's defaults (`docs/plans/b3-payments.md` §9). The owner approved "defaults are fine"; these three change accounting behaviour, so they stay listed until Ibrahim signs them off in person.

| # | Decision | Chosen default | Status |
|---|---|---|---|
| D2 | Cancel a case from «مرتجعة» when payments exist (closes item 18) | Allowed with a mandatory reason (blocking it once invoiced is a B6 task, S13); bound payments stay as account credit; audit records total and bound amount | pending owner sign-off (Ibrahim) |
| D3 | Cheque status machine | `pending→cleared`, `pending→returned`, `cleared→returned`; `returned` is final; no revert (a mistake is fixed by voiding and re-entering) | pending owner sign-off (Ibrahim) |
| D9 | Void a payment whose cheque is already cleared | Allowed with a reason; reverses its income; audited | pending owner sign-off (Ibrahim) |

## Questions for Ibrahim (B5)

Built with the plan's defaults (`docs/plans/b5-delivery-notifications-backlog.md` §12, N1–N2). To confirm in person together with D2, D3, D9 above and X1–X3 below.

| # | Question | Built as | Status |
|---|---|---|---|
| Q1 | At delivery, does the doctor pay all, part or nothing, and is a date set for collecting the rest? | The delivery dialog asks «هل استلمت المبلغ؟»: all, part (an amount below what is due) or nothing; for part or nothing a collect date is required (on or after the delivery date, changeable later, cleared if the case comes back) and the case appears in the bell under «تحصيل مستحق» on that day | pending owner answer (Ibrahim) |
| Q2 | Is a cheque received at delivery deducted from the remaining amount when received, or only when it clears? | Counted only when it clears (SPEC §7.4, D3), but at delivery the amount due already leaves out the doctor's cheques for this case that have not cleared yet, so the dialog never asks twice for money handed over as a cheque (N1) | pending owner answer (Ibrahim) |

## B4b defaults pending owner sign-off (Ibrahim)

Approved as defaults with the B4b plan (`docs/plans/b4b-outgoing-expenses.md` §8). They change accounting behaviour, so they stay listed until signed off in person.

| # | Decision | Chosen default | Status |
|---|---|---|---|
| X1 | Where outgoing payments live | A separate `outgoing_payments` table; `cheques` shared with exactly one owner (database CHECK) | built; pending owner sign-off (Ibrahim) |
| X2 | Refund larger than the credit | Refused at creation (limit = credit − pending refund cheques); a later shrink shows the uncovered part as debt on the refund line (S19) | built; pending owner sign-off (Ibrahim) |
| X3 | Where a refund sits in the FIFO | A dated charge item among the cases (like the opening balance, D4) | built; pending owner sign-off (Ibrahim) |
| X9 | Salaries and technicians | A salary is an ordinary «رواتب» expense with the payee typed; technicians have no ledger (SPEC §7.2) | built; pending owner sign-off (Ibrahim) |

## Provisional decisions used by B6 (pending Ibrahim's sign-off; they do not block B6)

Recorded for the B6 plan (`docs/plans/b6-invoices.md`). Each is built or planned as stated and stays **provisional, pending Ibrahim's sign-off**; none of them blocks B6.

| # | Decision (as built) | Status |
|---|---|---|
| Q1 | Delivery allows full / part / none, with a collect date for part or none | provisional, pending Ibrahim's sign-off |
| Q2 | Cheques count only when cleared (SPEC §7.4) | owner-confirmed 2026-11-06 (SPEC §12 answer 5); the delivery detail N1 stays provisional, pending Ibrahim's sign-off |
| D2 | Cancel from «مرتجعة» allowed with a reason; bound payments stay as account credit (B6 blocks it once the case is on an active invoice, S13) | provisional, pending Ibrahim's sign-off |
| D3 | A cleared cheque can still be returned; `returned` is final | provisional, pending Ibrahim's sign-off |
| D9 | Voiding a payment (including an outgoing one with a cheque) needs a reason; never a delete | provisional, pending Ibrahim's sign-off |
| X1 | Outgoing payments in their own table | provisional, pending Ibrahim's sign-off |
| X2 | A refund is limited to the doctor's refundable credit | provisional, pending Ibrahim's sign-off |
| X3 | A refund is a dated charge item in the FIFO | provisional, pending Ibrahim's sign-off |
| X9 | Salaries are ordinary expenses | provisional, pending Ibrahim's sign-off |

## B6 departures from SPEC (approved with the plan, recorded in SPEC §5.14)

| # | SPEC said | Built as |
|---|---|---|
| P1 | `cases.invoice_id`; a void deletes the `invoice_cases` rows | No `cases.invoice_id`; `invoice_cases` keeps every row with `active`; a partial unique index = one active invoice per case; a void sets `active = false` |
| P2 | Optional invoice discount | No discount typed on the invoice; the discount line is Σ the case discounts |
| P3 | Free invoice "for one-off charges" | A document only; never changes a balance |
| P4 | `snapshot_json TEXT` | `snapshot jsonb` + `snapshot_sha256` (canonical JSON) verified on every read; triggers refuse any change to issued content and any delete |
| P5 | Lab logo "reference" in the snapshot | The logo bytes frozen in `document_images` (content-addressed); the snapshot names the hash |

## B6 decisions — provisional, pending Ibrahim's sign-off (they did not block B6)

Built as the plan's defaults (`docs/plans/b6-invoices.md` §11), approved by the owner on 2026-11-21.

| # | Decision | Built as | Status |
|---|---|---|---|
| I1 | Does a free invoice to a doctor change what he owes? | No — a document only; prints no balances | provisional, pending Ibrahim's sign-off |
| I2 | Invoice-level discount | None typed on the invoice; Σ case discounts shown | provisional, pending Ibrahim's sign-off |
| I3 | Number series of statements | Same series as invoices | provisional, pending Ibrahim's sign-off |
| I4 | «الرصيد السابق / الحالي» | Current = the doctor's balance at issue; previous = current − invoice total | provisional, pending Ibrahim's sign-off |
| I5 | Which cases can be invoiced | Delivered or ready, not cancelled, not on an active invoice | provisional, pending Ibrahim's sign-off |
| I6 | What an invoice locks | Header, lines, prices, discount and cancel; status moves, delivery, collect date and payments stay allowed | provisional, pending Ibrahim's sign-off |
| I7 | Reprint after the appearance changes | Content and layout frozen; colours, font size and margins follow the current appearance | provisional, pending Ibrahim's sign-off |
| I8 | Home «الفواتير» count | Active cases + free invoices | provisional, pending Ibrahim's sign-off |
| I9 | Printing receipts and outgoing vouchers | A new small slice **B6b** (SPEC §11) | provisional, pending Ibrahim's sign-off |
| I10 | Issue date | The lab's today only | provisional, pending Ibrahim's sign-off |
| I11 | Document language | Chosen at issue (default from Settings); a reprint may switch labels only | provisional, pending Ibrahim's sign-off |

## B6b — vouchers (built)

Receipt (`IN-`) and payment (`OUT-`) vouchers print from the payments and outgoing lists, the doctor tab and the case panel on the B6 print shell (`docs/plans/b6b-vouchers-and-cleanup.md`). Provisional: V1 a voucher shows the current lab profile (not a snapshot); V2 Arabic amount wording to be read once by an Arabic speaker — pending Ibrahim.
