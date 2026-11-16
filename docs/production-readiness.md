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
| 14 | "Money exists" check grows per milestone | `SettingsRepository.hasMoneyData` covers work-type prices, opening balances, special prices (B1) and any case (B2); B3 added payments (done); **B6 must add invoices**, or the currency could change under real amounts |
| 15 | Search speed | Doctor/catalog search and the case patient-name search use `ILIKE '%…%'` (sequential scan): fine for hundreds of doctors; for 20k cases decide on `pg_trgm` indexes with global search (B4) and the load test (B8) |
| 16 | Logo in the browser | Done in F0: fetched as a blob and shown through an object URL that is revoked on change/unmount |
| 17 | Pre-B1 databases | A database set up with the B0 first run has no settings and no expense categories. No customer install exists yet; developers reset their dev DB (`docker compose down -v`) |
| 18 | Cancel from "returned" (decided in B3 as D2, pending sign-off below) | Not allowed in B2. Decide in B3, once payments exist, whether a returned case may be cancelled and what happens to its payments (owner, B2) |
| 19 | Case search by patient | Contains-search on patient names returns personal data to any user with `cases.read`; fine with one owner, review when more roles exist |
| 20 | HTTPS / reverse proxy | The refresh cookie gets `Secure` from `req.secure`. Behind a TLS proxy (cloud, LAN #8) set Express `trust proxy`, enable HSTS (off on loopback http, ADR-0017) and review the loopback-only `API_HOST` rule |
| 21 | Web bundle size | One chunk loaded from the local disk: 733 KB (229 KB gzip) in F0, 1,000 KB (302 KB gzip) after F2 (cases screens, cmdk, react-day-picker with date-fns; only the ar/en calendar locales are bundled), 1,030 KB (310 KB gzip) after F2b (Home, row actions; no new package). Split by route (React Router `lazy`) if start-up gets slow |

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
| S3 | Shade guide | «الأكثر استخدامًا» row (SPEC §5.5) | Needs usage counts from the API (e.g. top shades of the last N lines); not built in F2 |
| S4 | Add case | Same tooth twice | SPEC default kept: several lines per tooth are allowed without asking (crown + abutment); a "replace or add" question can be added if the owner wants it |
| S5 | Tooth chart | Work-type colours | The chart colours work types from a fixed palette in order of first use on the case (no colour field in the API). A colour per work type would need a setting (B-slice) |
| S6 | Tooth chart | Artwork | Our own parametric drawing (`features/cases/chart/geometry.ts`), to be replaced by licensed artwork; only the artwork layer changes (SPEC §1.1) |
| S7 | Home | Action cards for payments, debts, cheques and invoices | **Done for payments, debts and cheques (B3):** the three cards link to their screens with live figures from `GET /ledger/summary` (received this month, owed to the lab, cheques due soon or overdue). «دفعة صادرة» and «إنشاء فاتورة» stay «قريباً» until their slices ship |
| S8 | Home | «الأرقام الرئيسية» and «آخر العمليات» panels of direction A | Key numbers now include received this month, owed to the lab and pending cheques (B3). Expenses and invoices need B6+; the «آخر العمليات» feed (audit log) is still not built |
| S9 | Cases | Row «⋮» menu reads the case when opened | One GET per menu opening, so the list does not carry allowedStatuses/canCancel for every row. If the menu feels slow, add those fields to the list items (additive API change) |
| S10 | Payments | Outgoing payments, refunds and the separate «إلغاء دفعة» page | Not in B3 (owner scope). A doctor who overpays shows a credit («مستحق عليّ») that cannot be refunded in the app yet; voiding is a row action on the payments list |
| S11 | Debts | Breakdown modal and CSV export (SPEC 5.11) | The row opens the doctor statement instead; CSV export comes with B4 |
| S12 | Cases | Per-row paid / remaining in the cases list | `GET /cases/{id}` carries `paid` and `remaining`; the list does not (one allocation per doctor per row would be costly). Add with B4 if wanted |
| S13 | Cancel from returned | «Blocked once invoiced» (SPEC 7.8) | Not enforced yet because invoices do not exist; B6 must refuse cancelling a case on an active invoice |

## B3 defaults pending owner sign-off (Ibrahim)

Implemented as the plan's defaults (`docs/plans/b3-payments.md` §9). The owner approved "defaults are fine"; these three change accounting behaviour, so they stay listed until Ibrahim signs them off in person.

| # | Decision | Chosen default | Status |
|---|---|---|---|
| D2 | Cancel a case from «مرتجعة» when payments exist (closes item 18) | Allowed with a mandatory reason (blocking it once invoiced is a B6 task, S13); bound payments stay as account credit; audit records total and bound amount | pending owner sign-off (Ibrahim) |
| D3 | Cheque status machine | `pending→cleared`, `pending→returned`, `cleared→returned`; `returned` is final; no revert (a mistake is fixed by voiding and re-entering) | pending owner sign-off (Ibrahim) |
| D9 | Void a payment whose cheque is already cleared | Allowed with a reason; reverses its income; audited | pending owner sign-off (Ibrahim) |
