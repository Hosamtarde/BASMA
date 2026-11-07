# Production readiness — pre-production tasks (not in v1)

Items to decide or build before selling the product to other labs (SPEC §2.4). Updated as milestones progress.

| # | Task | Notes |
|---|---|---|
| 1 | Final product name | Replace the `PRODUCT_NAME` placeholder (one constant); check trademark and domain |
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
| 14 | "Money exists" check grows per milestone | `SettingsRepository.hasMoneyData` covers work-type prices, opening balances, special prices (B1) and any case (B2); **B3 must add payments, B6 invoices**, or the currency could change under real amounts |
| 15 | Search speed | Doctor/catalog search and the case patient-name search use `ILIKE '%…%'` (sequential scan): fine for hundreds of doctors; for 20k cases decide on `pg_trgm` indexes with global search (B4) and the load test (B8) |
| 16 | Logo in the browser | Done in F0: fetched as a blob and shown through an object URL that is revoked on change/unmount |
| 17 | Pre-B1 databases | A database set up with the B0 first run has no settings and no expense categories. No customer install exists yet; developers reset their dev DB (`docker compose down -v`) |
| 18 | Open item for B3: cancel from "returned" | Not allowed in B2. Decide in B3, once payments exist, whether a returned case may be cancelled and what happens to its payments (owner, B2) |
| 19 | Case search by patient | Contains-search on patient names returns personal data to any user with `cases.read`; fine with one owner, review when more roles exist |
| 20 | HTTPS / reverse proxy | The refresh cookie gets `Secure` from `req.secure`. Behind a TLS proxy (cloud, LAN #8) set Express `trust proxy`, enable HSTS (off on loopback http, ADR-0017) and review the loopback-only `API_HOST` rule |
| 21 | Web bundle size | One chunk loaded from the local disk: 733 KB (229 KB gzip) in F0, 1,000 KB (302 KB gzip) after F2 (cases screens, cmdk, react-day-picker with date-fns; only the ar/en calendar locales are bundled), 1,030 KB (310 KB gzip) after F2b (Home, row actions; no new package). Split by route (React Router `lazy`) if start-up gets slow |

## Open decisions — editions (`docs/editions.md`, ADR-0018)

| # | Decision | Notes |
|---|---|---|
| D1 | Final product name | Name of the `generic` edition; replaces the `{{PRODUCT_NAME}}` placeholder (same item as #1) |
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
| S7 | Home | Action cards for payments, debts, cheques and invoices | Shown with «قريباً» and no link (F2b). Each becomes a link with a live figure when its slice ships: add `to` in `features/home/ActionCards.tsx` and its figure (the mockup's: incoming/outgoing this month, owed to the lab, cheques due in 7 days, cases waiting for an invoice) |
| S8 | Home | «الأرقام الرئيسية» and «آخر العمليات» panels of direction A | Need money (B3–B6) and an activity feed; F2b shows the status donut and the latest cases instead |
| S9 | Cases | Row «⋮» menu reads the case when opened | One GET per menu opening, so the list does not carry allowedStatuses/canCancel for every row. If the menu feels slow, add those fields to the list items (additive API change) |
