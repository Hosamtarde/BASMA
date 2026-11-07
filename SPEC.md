# Dental Lab Management System — product name `PRODUCT_NAME` (TBD), built by Smile Artec Dental Laboratory

> Spec for Claude Code. Written in English for implementation accuracy. **The product is Arabic by default (RTL) and fully switchable to English (LTR)** — see §6.1. Arabic labels in `«…»` are the source wording; the English equivalents live in the i18n catalogs.
> Language of the person you are working with: Arabic (Palestinian dialect). Talk to them in Arabic; write code, comments and commit messages in English.

---

## 0. What we are building

A **management system (backend/API first, UI later) for a dental technician laboratory** — built by and first used at **Smile Artec Dental Laboratory** (the owner's own lab, the "main lab"), later distributed to other labs under a separate product name (`PRODUCT_NAME`, still to be chosen) that receives dental cases from doctors, tracks them until delivery, and manages the lab's money: prices, invoices, payments in/out, cheques and outstanding debts.

It is a **reduced edition** of a commercial product the owner already knows (an Arabic dental clinic/lab program called "الإخلاص / AL EKHLAS"). The owner's instruction is: *"same program, but remove what we don't need, and for what stays, same behaviour."*

### 0.1 Ground rules — read carefully
1. **Behaviour parity, original implementation.** Match the *workflow, screens, fields and business rules* described in this document. Do **not** copy or look for the reference product's source code, images, icons, tooth-chart artwork or text assets. Write everything from scratch (own SVG tooth chart, own icons, own CSS).
2. **Branding is the lab's own** (section 1). No Al-Ekhlas name, logo, or wording like "الإخلاص" anywhere in the app.
3. **Never invent business rules silently.** Anything in section 12 ("Decisions & open questions") is an assumption — confirm with the owner before building the dependent feature if it is risky, otherwise implement the stated default and keep it easy to change.
4. **Money is never a float.** See section 7.
5. **Nothing financial is ever deleted** — it is *voided* with a reason and stays visible.
6. **Backend first, frontend later.** Phase 1 = the complete backend (domain rules, database, API, security, tests, docs). Phase 2 = the frontend, which starts only after the owner signs off the backend and we agree together on the look (colours, layout) — see section 11. Do not scaffold or design any UI in Phase 1.
7. Work in milestones (section 11). Stop after each milestone and show the owner what works.
8. Follow `ENGINEERING_STANDARDS.md` in full. Where it conflicts with this SPEC on *business scope*, the SPEC wins (its list of possible domain modules is only a menu — we build §3.1). On *engineering quality* (security, testing, architecture), the standards win.
9. Use the project skills in `.claude/skills/` — load the matching one before each kind of task.

---

## 1. Branding

> **Phase 2 only.** Nothing here affects the backend except the lab-profile settings (name, logo reference). The colours are a starting point: **agree the final look with the owner before the first UI line is written.**

Source files (`assets/`): `logo-clean.png` (transparent lockup: tooth + SMILE ARTEC + DENTAL LABORATORY, 1115×775 — use for app/invoices), `logo-full.png` (same with the «ART MEETS TECHNOLOGY» tagline and rules), `logo-small.png` (400 px wide), `logo-hires-source.png` (1536×1024 original on white). Raster only — an SVG/vector original would be welcome later.

| Item | Value |
|---|---|
| Vendor / main lab (EN) | **SMILE ARTEC** — Dental Laboratory (the owner's lab — **not** the product name) |
| Tagline | **ART MEETS TECHNOLOGY** |
| Lab name (AR) | *unknown — ask the owner*; default the setting to empty and fall back to the English name |
| Logo | A tooth drawn with two sweeping blue/teal ribbons, with a small 4-square pixel cluster at the top-right (the "technology" motif) |

**Palette (sampled from the high-resolution logo):**
- Cyan (logo right side / accents): `#03C3DB` — use the slightly darker `#03A9C4` for text/lines on white
- Blue (logo middle): `#006EBD`
- Navy (logo left side, table headers): `#01416C`
- Ink / text: `#023F65`
- Surface: `#F4F8FA`, card: `#FFFFFF`, border: `#DCE6EC`
- Status colours (see 9): waiting `#E0A100`, design `#7A5AF8`, in-progress `#006EBD`, ready `#1E9E6A`, delivered `#03A9C4`, returned `#D6453D`, cancelled `#8A98A3`.

**Usage rules**
- **Per installation, the lab's own logo + name** appear on the home banner and on every printed invoice/statement/receipt. The Smile Artec logo is the **vendor mark** (installer, splash, a discreet «Powered by Smile Artec Dental Laboratory» line) and is the lab profile of the owner's own installation.
- The product's own name/logo (`PRODUCT_NAME`) is chosen by the owner; use a single constant/config for it — never hard-code it in strings, file names or installer scripts.
- The logo is raster: never upscale it past its native size; for print keep it ≤ 60 mm wide. The logo path is a setting (Settings → «شعار المختبر») so it can be replaced (e.g. by an SVG) without code changes.
- Gradient: sidebar and primary buttons use the logo gradient navy → blue → cyan (`#01416C → #006EBD → #03C3DB`).
- Font: **Cairo** (or Tajawal), bundled locally — the app must work fully offline.
- UI is RTL; numbers inside Arabic text use Western digits (0-9) everywhere (the owner's current program does).

### 1.1 Approved look — DECIDED by the owner (2026-11-07)
Mockups and screenshots: `docs/design-directions/` (A, B, C; A is the reference).
- **Direction A «تدرّج الشعار / Brand gradient» is approved**: gradient sidebar (navy → blue), white top bar, cards with soft spacing, shade-tab action cards on Home. Light theme only.
- **Taken from direction C**, each built in its own slice: the **case pipeline strip** on Home (waiting → … → delivered with counts) and the **dense case-list rows** (status colour bar per row).
- **Contrast fix** (WCAG AA): logo cyan `#03C3DB` is for accents, borders and the gradient only; text uses darker shades (e.g. `#06728A`); status badges use a tinted background, darker text and a dot in the exact status colour.
- **Tooth chart artwork** is our own vector drawing for now and will later be replaced by **licensed realistic artwork**. The chart keeps three separate layers — **artwork**, **hotspots** (all interaction and accessibility) and **number badges** — so the artwork can be swapped without touching the other two.
- **Chart models:** the **mouth view** (two U-shaped arches) is the default; **front rows** (straight upper/lower rows with roots) is the alternative. A toggle switches them and the choice is remembered.
- **Chart fits the screen (applies to the real F2 chart too):** the whole chart (both arches, all 32 teeth and numbers) is always visible without scrolling. The chart panel is sticky and sized to the visible viewport height, the chart scales with its SVG viewBox, and the form column scrolls on its own. Number badges are at least 16 px (14 px only on very short screens). When the available height is under about 560 px, a «تكبير المخطط» button opens the chart full-screen in a dialog (Esc closes, selection kept).
- No image, code or asset from the reference program is used anywhere (§0.1).

---

## 2. Architecture & tech stack

**Style:** modular monolith — one backend service, one database, clean layering (presentation → application → domain ← infrastructure). No microservices, queues, caches or Redis unless a *measured* need appears (YAGNI).

**Delivery:** REST API with OpenAPI/Swagger, versioned under `/api/v1`. The frontend (Phase 2) is a separate app consuming only that API. Repo is a monorepo: `apps/api` now, `apps/web` later.

**Stack — DECIDED by the owner:** TypeScript + **NestJS** and **PostgreSQL**. Do not re-litigate; choose the remaining pieces and justify each briefly in an ADR.
Versions in use (B0, see `docs/adr/0015-toolchain-versions.md`): **NestJS 12** (stable/GA line), **Node.js 24 LTS**, **TypeScript 6.0**, **PostgreSQL 16**. Remaining pieces:
- one migration tool (Prisma Migrate / Drizzle / Knex), **Argon2id** hashing, access + rotating refresh tokens (or server sessions), zod/class-validator at boundaries, Pino structured logging with correlation IDs
- Jest or Vitest + Supertest + Testcontainers for integration tests
- Docker + Docker Compose for **development only**; GitHub Actions CI (lint, typecheck, tests, build, dependency audit)

### 2.1 Delivery: an installable Windows package (REQUIRED)
The owner will **install the system on the lab's computers from a single compressed installer** (`SmileArtec-Setup-x.y.z.exe`, optionally distributed inside a `.zip`/`.rar`). Docker is **not** required on the lab's machines. The installer must:
- bundle the compiled API (with a bundled Node runtime) and **portable PostgreSQL binaries**; install both as **Windows services** (auto-start, restart on failure), with the database on a private port and a randomly generated DB password stored protected (never hard-coded, never in the repo);
- create the database, run migrations, and start the first-run owner setup;
- (Phase 2) serve the built frontend from the same service, so users open the app from a shortcut/browser at `http://localhost:<port>` (or an app window wrapper if the owner prefers);
- support **upgrade in place**: stop services → automatic pre-upgrade backup (`pg_dump`) → migrate → start; and **rollback** to the backup if migration fails; never touch the data folder on uninstall unless the owner explicitly chooses to;
- offer scheduled automatic backups (e.g. daily + on exit/upgrade) to a folder the owner picks, keep the last N, and a restore procedure that is tested;
- run fully offline; no telemetry; logs rotated in a known folder.

### 2.2 Distribution model — DECIDED by the owner
- The product is distributed like a normal desktop program: **each lab/customer downloads the compressed installer and installs it on its own computer(s), with its own independent installation, its own account and its own data.** No shared database between installations, no central server in v1.
- "Registration" = **local first-run setup, fully offline**: create the owner account (username + password) and the lab profile (name, phone, address, currency, logo). Nothing is sent anywhere.
- Each installation is **single-tenant**. Nothing about a specific lab may be hard-coded: lab name, logo, currency, numbering prefixes and invoice template all come from that installation's settings.
- Data safety is therefore the owner's backup folder (§2.1) — make backup status visible and easy to restore.

### 2.3 Product identity vs lab identity — DECIDED
- **"Smile Artec" is the owner's own laboratory** (the *main lab*), not the product name. The product that will be distributed to other labs gets **its own name, `PRODUCT_NAME` (to be chosen by the owner)**, defined in one place (config/constant) and used by the installer, window title, splash/login screen and docs.
- **Lab identity = per installation:** each lab's own name and logo (entered at first run, editable in Settings) appear on its invoices, statements and receipts. **Never fall back to the Smile Artec logo on another lab's documents** — if no logo is uploaded, print the lab name only.
- The owner's installation is simply the first customer: its lab profile is Smile Artec (name + logo from `assets/`).
- Vendor credit «Powered by Smile Artec Dental Laboratory» may appear on the splash/login screen only (not on invoices).

### 2.4 Going to production later (NOT in v1 — design for it, do not build it)
The owner plans to think about a production/commercial rollout after the system matures. Keep these doors open without building them (YAGNI):
- **Licensing/subscription & activation** (the reference product is subscription-based): leave a clear seam (one `LicenseService` interface, not implemented) and record an ADR; decide with the owner later.
- **Updates distribution** (signed installers, in-app update check): v1 = manual installer upgrade (§2.1) only.
- **Cloud/multi-tenant variant**: keep domain and application code free of Windows-specific assumptions; all environment specifics (paths, ports, DB connection, secrets) in config. No `tenant_id` columns now; document in an ADR what would change.
- **Code signing, installer branding, support/diagnostics bundle** — list as pre-production tasks in `docs/production-readiness.md`.

Layout suggestion:
```
apps/api/src/modules/<module>/{domain,application,infrastructure,presentation}
apps/api/src/{shared,config}
apps/api/test/{unit,integration,e2e}
docs/{00-assessment.md, adr/}
```
Cross-cutting from day one (including **i18n readiness**: stable error/message codes with parameters, localized by `Accept-Language`, Arabic default — see §6.1): env-based config validated at boot, centralized exception filter, structured logging, health/readiness endpoints, graceful shutdown, DTO-only API responses (no entities leaking).

---

## 3. Scope

### 3.1 IN (v1)
| Module | Arabic |
|---|---|
| Home dashboard | «الرئيسية» |
| Add new case (with tooth chart) | «إضافة حالة جديدة» |
| Incoming payment | «دفعة واردة» |
| Create outgoing payment | «إنشاء دفعة صادرة» |
| Cancel payment (void) | «إلغاء دفعة» *(see 12 — kept because the ledger needs a void flow)* |
| Debts / outstanding amounts | «الديون» |
| Cheque register | «سجل الشيكات» |
| Create invoice (+ account statement) | «إنشاء فاتورة» |
| Invoice appearance / template | «مظهر الفاتورة» |
| Doctors directory (opened from the home card) | «الأطباء» |
| Case details screen (open/edit/deliver) | «تفاصيل الحالة» *(required for the workflow; not in the owner's list)* |
| Global search, notification bell | — |
| Settings: lab profile, logo, currency, backup/restore | «الإعدادات» |

### 3.2 OUT (do not build, do not leave dead menu items)
Labs («المختبرات»), Staff/Employees and their advances/absences («الموظفون», «سجل الموظفين»), Companies («الشركات»), exocad inbox/link, User-management UI/CRUD («المستخدمين» — authentication itself is IN, see 3.3), About («حول البرنامج»), Dark mode, WhatsApp/Telegram sending, auto-update, product tour, multi-currency, instalments, supply invoices/materials stock, delegates/couriers («المناديب»), card hide/reorder, messaging.

### 3.3 Security baseline
The owner said user management is "not important", but the engineering standards require authentication and server-side authorization. So v1 has:
- Authentication, with **one `owner` role holding all permissions**.
- RBAC structures in place (users, roles, a single policy/permission layer) so roles such as accountant / reception / technician can be added later without redesign.
- First-run owner creation (setup endpoint that locks itself after first use), login/logout/refresh, change own password.
- Audit log carries the acting user id.
- **No other user-management endpoints or screens in v1.** Ask the owner if more is wanted.

---

## 4. Navigation (Phase 2 — frontend)

Right-hand sidebar (RTL), logo + lab name at top, items in this order:

1. «الرئيسية»
2. «إضافة حالة جديدة»
3. «دفعة واردة»
4. «إنشاء دفعة صادرة»
5. «إلغاء دفعة»
6. «الديون»
7. «سجل الشيكات»
8. «إنشاء فاتورة»
9. «مظهر الفاتورة»
10. «الإعدادات» (bottom)

Top bar: search box «ابحث عن طبيب أو حالة...», notification bell with unread count, and the quick-action icons for Settings. Pages open as normal routes; secondary dialogs (work types, shade picker, delivery, doctor quick-add) are modal windows.

---

## 5. Screens — detailed behaviour

> These screens are the **product contract**. In Phase 1 build the use-cases, rules, validation and API endpoints behind each screen (no UI). Layout, visuals, printing and file pickers belong to Phase 2; the backend must expose what they need (invoice snapshot JSON, invoice template JSON, CSV export endpoints, backup operations, notifications feed, search).

### 5.1 Home «الرئيسية»
- **Banner:** lab logo + name + tagline (replaces the stock clinic photo of the reference).
- **Six stat cards**, each clickable:
  | Card | Value | Click opens |
  |---|---|---|
  | «الأطباء» | number of active doctors | Doctors directory |
  | «الحالات» | number of cases (excluding cancelled) | Cases list (filter by status) |
  | «الدخل» | total received (active incoming payments counted per cheque rule §7.4) | Receipts report |
  | «المبالغ المستحقة» | total owed to the lab by doctors | Debts |
  | «المصاريف» | total outgoing | Expenses report |
  | «الفواتير» | number of active invoices | Invoice list |
- **Panel «بيان عام على جميع الحالات»:** donut chart + legend with the count per status (see §9). Clicking a status opens the cases list filtered to it.
- **Panel «آخر العمليات»:** last 20 operations (date/time, short Arabic description e.g. «إنشاء فاتورة رقم 1 للدكتور …»), from `audit_log`.
- **Overdue marker:** any case whose expected date has passed and is not delivered/cancelled shows «⚠️ متأخرة» in lists and on the case.
- Empty state when there are no cases: «لا توجد حالات مسجلة بعد.»

### 5.2 Doctors directory «الأطباء»
- List with search; columns: name, clinic, phone, number of cases, current balance (§7.3).
- «إضافة طبيب جديد»: **name (required, unique, case-insensitive)**, phone, clinic, notes, opening balance (optional, signed). Empty or duplicate name is rejected with an inline Arabic message.
- Open a doctor → **doctor account**: summary (total case prices, total payments received, paid out to doctor, amount due), cases table, payments table, **special prices** tab (see 5.12), buttons «كشف حساب» (opens the statement flow of 5.9) and «دفعة واردة».
- Doctors are never deleted if they have any case or payment; they can be set inactive.

### 5.3 Add new case «إضافة حالة جديدة»  — the core screen
Two-panel layout.

**Left (visual): tooth chart** — «تحديد الأسنان»
- Own SVG drawing of the full adult dentition (upper and lower arch) with **FDI numbering**: upper 18…11 | 21…28, lower 48…41 | 31…38 (32 teeth), numbers visible on each tooth.
- Click a tooth to select/deselect (multi-select). Selected teeth are highlighted in the primary colour; teeth that already have a work line show the work type's colour/badge.
- Helper actions: «تحديد الكل», «مسح التحديد», quadrant shortcuts (UR/UL/LR/LL).

**Right (form): «بيانات الحالة»**
| Field | Rules |
|---|---|
| Doctor «الطبيب» | required; dropdown with search; button «+ أضف طبيب آخر» opens the quick-add modal (name required/unique, phone, clinic) and selects the new doctor |
| Patient name «اسم المريض» | required, free text |
| Technician «الفني» | dropdown from `technicians`; button «+ أضف فني آخر» (name only). Optional field |
| Work type «نوع العمل» | dropdown from work types; button «⚙ أنواع العمل» opens the work-types manager (5.4) |
| Shade «اللون» | opens the shade picker modal (5.5); optional |
| «+ إضافة حالة العمل» | applies the chosen work type (+shade) to **all selected teeth**, creating one line per tooth with the price resolved at that moment (§7.5), then clears the selection |
| «التواريخ والحالة» | received date (default today), expected delivery date (required, ≥ received date), status (default «قيد التصميم») |
| Advance «الدفعة المقدمة» | optional amount; if > 0 an **incoming payment** is created and bound to the case (method cash by default; cheque allowed → asks cheque fields) |
| Notes «ملاحظات» | placeholder «أي ملاحظات إضافية على الحالة...» |

**Work lines table** (below/beside): per tooth — tooth no., work type, shade, unit price, remove button; editable price override per line (shows «★ سعر خاص» when the doctor-specific price was applied). Footer: subtotal, optional case discount, **total**.

**Rules**
- At least one work type must exist before a case can be added; otherwise show: «أضف نوع عمل واحدًا على الأقل أولًا، ثم أعد فتح "إضافة حالة".» and open the manager.
- A case needs ≥ 1 work line.
- Save → assigns the next `case_no`, writes `case_items`, status history entry, audit entry, optional advance payment, then shows a success toast with the case number and offers «إضافة حالة أخرى» / «فتح الحالة».
- Selecting teeth that already have a line asks whether to replace or add another line for the same tooth (e.g. a crown and an abutment can coexist) — default: allow multiple lines per tooth.
- **Owner decisions (B2):** a line is on **one FDI tooth or one area** (`upper_arch`, `lower_arch`, `both_arches`, `none`) — exactly one; at most **100 lines** per case; shade is **free text ≤ 20** (the Vita picker is a UI aid only); the **doctor cannot change** after creation; the received date is **never in the future** (lab time zone); patient names are **not written to the audit log**. The advance payment is added in B3 (needs payments).

### 5.4 Work types manager «أنواع العمل»
- Table: name, **price per tooth**, actions (rename, edit price, delete/deactivate).
- Add: name (required, unique), price (≥ 0). Messages: «هذا النوع أُضيف مسبقًا.», «الاسم فارغ.»
- Delete: confirmation; if the type is used by any case → deactivate instead of delete (old cases keep their snapshot `work_type_name` and price).
- Editing a price affects only **new** lines (existing lines keep their snapshot price).
- **No seed list (owner decision, B1):** the work-type list starts empty; the owner enters their own types and prices. No prices are ever invented by the system.

### 5.5 Shade picker «اختيار اللون»
- Modal with the classic Vita shade guide grouped A1–A4, B1–B4, C1–C4, D2–D4 (plus bleach BL1–BL4), «الأكثر استخدامًا» row (computed from past use), and «بدون لون».
- Footnote: «ألوان الشاشة للإرشاد فقط وليست بديلًا عن دليل الألوان أو جهاز القياس.»

### 5.6 Case details «تفاصيل الحالة»
Opened from lists/search/dashboard.
- Header: case no, doctor, patient, technician, status badge, dates, overdue marker.
- Work lines, totals, **paid / remaining** (computed, §7.3), linked invoice (if any), status history timeline, notes.
- Actions: change status (with note), edit case (**blocked once invoiced** — show why), «تسليم الحالة» (5.7), «دفعة واردة لهذه الحالة», cancel case (only if not delivered/invoiced; payments bound to it are kept as account credit).
- Every edit is audit-logged.

### 5.7 Delivery «تسليم الحالة»
When status changes to «تم التسليم» (from any path) show the dialog:
1. Sets `delivered_date` (default today).
2. Asks **«هل استلمت المبلغ؟»** — three choices: «نعم، كاملًا» / «جزء منه» / «لا».
   - Full: creates an incoming payment bound to the case for the remaining amount.
   - Partial: amount field; **must not exceed the amount left on the case** («المبلغ أكبر من المتبقي على الحالة.»); then «حدد تاريخ تحصيل الباقي» → saved on `cases.collect_on`, raises a notification when due.
   - None: asks for the collect date the same way.
3. Message if already delivered: «هذه الحالة مسلّمة بالفعل.»

### 5.8 Incoming payment «دفعة واردة»
Fields: doctor (required) → show his current balance; amount (> 0); method **cash / cheque**; if cheque: cheque no., bank, due date; payment date (default today); optional bound case (dropdown of his open cases, default «غير مرتبطة بحالة»); note.
Button «تسجيل الدفعة». Success toast shows new balance.
Below: **«تقرير المقبوضات»** — table of incoming payments (no., date, doctor, method, amount, status) with filters (date range, doctor, method), total, and «آخر دفعة». Row actions: print receipt (A4 small receipt with logo), cancel.

### 5.9 Outgoing payment «إنشاء دفعة صادرة»
Fields: **category** (from `expense_categories`, editable list seeded at first run in the setup language: إيجار، كهرباء، ماء، مواد، رواتب، مواصلات، أخرى, + the system category «طبيب (استرداد)», which can be renamed but never deleted or deactivated — owner decision B1) ; payee (free text, required except for doctor category); if category = doctor → doctor dropdown instead; amount (> 0); method cash/cheque (+cheque fields); date; note.
- Doctor category = money returned to a doctor (refund / overpayment): increases what the lab owes him (§7.3).
- Success: «✅ تم حفظ المصروف».
- Below: **«تقرير المصاريف»** with date/category filters and totals per category.

### 5.10 Cancel payment «إلغاء دفعة»
List of active payments (in & out) with search/filter. Choose one → confirm dialog with optional reason → payment becomes `void` (stays visible, struck-through, with the reason); balances and totals are restored automatically; a linked cheque is voided too. Voiding a payment never deletes it.

### 5.11 Debts «الديون»
- Info banner: «كل مبلغ مستحق محسوب تلقائيًا من أسعار الحالات والدفعات، ويُسجَّل على الجهة التي تعود لها الحالة أو العملية. اضغط على أي اسم لمعرفة سبب المبلغ بالتفصيل.»
- Four summary cards: **number of parties with a balance**, **total owed to me** «إجمالي المستحق لي», **total owed by me** «إجمالي المستحق عليّ», **net** «الصافي».
- Table: name · category («طبيب») · direction badge («مستحق لي» green / «مستحق عليّ» orange) · amount. Sort by amount desc; filter «الكل / لي / عليّ»; search.
- Click a name → breakdown modal: total case prices, total payments received, amounts paid out to him, **amount due**, then the cases that make up the amount (case no., patient, date, price, paid, remaining) and the payments list.
- Export button «تصدير CSV».

### 5.12 Special prices (inside a doctor's account)
Table of work types with an optional **special price for this doctor**; empty = use general price. Lines created for this doctor use the special price and are marked «★ سعر خاص».

### 5.13 Cheque register «سجل الشيكات»
- Every incoming and outgoing cheque: number, direction, party/payee, bank, amount, due date, status, linked payment.
- Filter chips: «الكل / واردة / صادرة / قيد التحصيل / تم الصرف / مرتجعة» + search + date range. Rows due within 7 days are highlighted; overdue pending ones in red.
- Statuses: `pending` «قيد التحصيل» → `cleared` «تم الصرف» or `returned` «مرتجع».
- Marking **returned** on an incoming cheque restores the doctor's debt automatically (the cheque stops counting, §7.4) and writes an audit record.
- Cheques are created only through payments (5.8/5.9/5.3 advance); the register itself only changes status.

### 5.14 New invoice «إنشاء فاتورة»
Choose the invoice type first:
1. **«فاتورة حالات»** — pick a doctor → table «حالات منجزة غير مفوترة» (delivered or ready, not yet on any active invoice; checkboxes, select-all) → optional invoice discount, notes → «إنشاء وطباعة». Message when empty: «لا توجد حالات بانتظار الفوترة.» A case can belong to **one active invoice only** («هذه الحالة مفوترة بالفعل.»).
2. **«كشف حساب»** — pick a doctor (+ optional date range) → shows every case/payment with running balance and the closing balance; print/save PDF. Stored as a document in the invoice list but **does not** mark cases as invoiced.
3. **«فاتورة حرة»** — party (doctor from list or free name), reason, amount (> 0). For one-off charges.

**Invoice rules**
- Sequential number per lab (`invoices.no`), date, **immutable after creation** («لا يمكن تعديل الفاتورة بعد إنشائها لحمايتها من العبث»). To correct: **void** it with a reason (it stays listed as «ملغاة» and its cases become un-invoiced) and issue a new one.
- Totals are computed on the main side; the renderer-side total must equal it, otherwise abort («الإجمالي المعروض لا يطابق حساب البرنامج — راجع البنود.»).
- Invoice stores a **JSON snapshot** of all printed data (lab name, logo ref, lines, prices) so later price/template changes never alter an old invoice. Reprint always renders from the snapshot with the *current template* styling only for colours/fonts (content never changes).
- Invoice list «الفواتير»: search by number/doctor, status filter, open → view/reprint/void.

**Reference design:** `docs/reference/invoice-sample.html` (+ `.pdf`/`.png`) is the approved starting look: lab logo + lab name/phone/address (from the installation's lab profile) at the header start, «فاتورة» title with a meta box (number, date, period) at the end, doctor block, striped lines table, totals box (subtotal, discount, **grand total** highlighted, previous/current balance), notes, signature lines, footer with lab name and page numbers. Colours/fonts/columns follow the template settings (§5.15) through CSS variables. Sample data and the Arabic lab name are placeholders — use the real settings. The Smile Artec logo here is the owner's own lab profile; **other labs print their own logo/name only** (§2.3).
**Backend implications (Phase 1):** the invoice snapshot must contain everything this layout prints — lab profile (name, phone, address, logo reference), doctor/party, **printed lines grouped** by case + work type + shade + unit price (teeth list + qty), subtotal, discount, total, previous/current balance, period, notes, language and currency settings — so the frontend only renders.
**Printed invoice (A4, RTL)**: logo + lab name + phone/address header; title «فاتورة» + number + date; doctor block; lines table (case no., patient, teeth, work type, shade, qty, unit price, total — columns configurable, 5.15); subtotal, discount, **total**; optional «الرصيد السابق / الرصيد الحالي»; footer text; page numbers when > 1 page.

### 5.15 Invoice appearance «مظهر الفاتورة»
Left: settings; right: **live preview** rendered by the *same* invoice renderer used for printing, filled with sample data («عيادة تجريبية», «تاج زيركون», «جسر خزف»).
Settings: primary colour, header text colour, table header colour, font size (S/M/L or numeric), **column toggles** and optional width per column (blank = auto), show logo (on/off), show balances (on/off), footer text, paper margins. «حفظ» persists to `settings` (`invoice_template` JSON). Message on save: «تم حفظ إعدادات أعمدة الفاتورة.»

### 5.16 Notifications (bell)
Generated, not manually created; dismissible (store dismissals):
- Case delivery due within 2 days / overdue.
- Cheque due within 7 days / overdue pending.
- «تحصيل مستحق» — a `collect_on` date reached for a partially paid delivered case.
Bell shows the count; panel groups by type.

### 5.17 Global search
Single box; matches doctor name, patient name or case number as you type (debounce 150 ms); grouped results (doctors / cases); no exact match → show closest matches.

### 5.18 Settings «الإعدادات»
- Lab profile: name AR/EN, phone, address, logo (file picker; no default logo — without one, the lab name is shown, §2.3).
- Currency: symbol/code (free text, e.g. ₪ / JOD / $), decimals (0–3). **Changing it after data exists is blocked** (show why) — v1 is single-currency, amounts are not converted.
- Language: UI language (Arabic default / English) and, separately, the language of printed documents (§6.1).
- Data & backup: data folder shown; «أخذ نسخة احتياطية الآن» (save a copy of the DB file to a chosen folder), «استرجاع نسخة» (validate it is a Smile Artec DB with a compatible schema version, back up the current one first, then replace and restart), **automatic backup on app close** keeping the last N (default 10) copies in a chosen folder.
- First run wizard: one step — owner account, lab name (Arabic or English) + phone + currency (required), language, time zone (default from the installation) — then offer to restore a backup.
- Logo: PNG/JPEG ≤ 1 MB, stored in the database so backups include it (owner decision B1). Currency code and decimals lock once any amount exists; the symbol stays editable (owner decision B1).

---

## 6. Global UX rules (Phase 2 — frontend; pagination/search/performance targets also apply to the API)
- UI is Arabic (default, RTL) or English (LTR) per §6.1; one consistent language per screen; destructive actions always confirm.
- Toasts for success, inline messages for validation (never only `alert()`).
- Dates stored ISO `YYYY-MM-DD`; displayed `YYYY-MM-DD` (same as the reference product).
- Keyboard: Enter submits forms, Esc closes modals, full tab order in RTL.
- Every list: search, sort, pagination (page size 25) — keep a reusable table component.
- Performance target: smooth with 20 000 cases / 50 000 payments (index accordingly).

### 6.1 Localization (Arabic by default, English switchable) — REQUIRED from day one
- **Two languages in v1: Arabic `ar` (default) and English `en`.** Architecture must allow adding more later without code changes.
- **No user-facing text hard-coded anywhere** (API or UI). All strings come from catalogs `ar.json` / `en.json`; every new string is added to **both** at the same time. A CI check fails when a key exists in one catalog and not the other.
- **Backend (Phase 1):** responses carry stable machine codes (`error.code`, enum values like `waiting`, `delivered`) plus parameters; human-readable messages are produced from the catalog using `Accept-Language` (fallback `ar`). Localize: validation and business-rule errors, status/direction/method labels, notification texts, report and CSV headers, audit-log summaries (store code + params, render on read, not frozen Arabic text), seed names.
- **Database stores codes, not translated labels** (e.g. status `'in_progress'`). User-entered data (doctor, patient, work-type names…) is stored as typed and never auto-translated.
- **Seed data** (expense categories only; work types start empty — owner decision B1) is created at first run **in the language chosen in the setup wizard**; changing the language later does not rename existing records.
- **Frontend (Phase 2):** switching language flips direction RTL↔LTR (logical CSS properties only), fonts (Arabic: Cairo/Tajawal; English: a matching Latin font), dates and number formatting; the choice persists per installation (and per user when users are added later). Digits: Western 0-9 by default in both languages, with a setting for Arabic-Indic digits.
- **Printed documents** (invoice, statement, receipt) have their own **document language** setting (default = UI language, can differ: e.g. UI English, invoices Arabic). Stored invoice snapshots keep the language they were issued in; reprints use the stored language unless the user explicitly reprints in another one.
- Tooth numbering (FDI) and shade codes (A1, B2…) are language-neutral.
- Tests: error/message codes covered in both languages; one E2E per language smoke-testing direction switching (Phase 2).

---

## 7. Domain & accounting rules

### 7.1 Money
- Stored as **integer minor units** (e.g. cents/agorot/fils) — never REAL. Decimals come from the currency setting.
- One `shared/money` module for parse/format/rounding (half-up), used by main and renderer. Unit-test it.

### 7.2 Parties
v1 has only one ledger party type: **doctor**. (Technicians are just a lookup list, no accounting.)

### 7.3 Balance of a doctor (computed, never stored)
```
charges   = opening_balance + Σ cases.total            (cases not cancelled)
received  = Σ active incoming payments counted per §7.4
paid_out  = Σ active outgoing payments to this doctor (category = doctor)
balance   = charges − received + paid_out
balance > 0  → owed to the lab    («مستحق لي»)
balance < 0  → lab owes the doctor («مستحق عليّ»)
```
- Case `remaining = case.total − paid_for_case`.
- `paid_for_case` = payments **bound** to the case + the case's share of **unbound** payments, applied **FIFO** (oldest case first by received date, then case no.) *at read time*. No allocation table; implement as a pure function `allocate(cases, payments)` with thorough unit tests.
- Case totals are cached in `cases.total` but recomputed from `case_items` and discount inside the same transaction on every change.
- Cases count towards dues **from creation** (not only after delivery) — default, see §12.

### 7.4 Cheques
- Incoming cheque: counts as received (and as income) **only when `cleared`**. While `pending` it is shown separately («شيكات قيد التحصيل») and does **not** reduce dues. `returned` never counts.
- Outgoing cheque: counts as an expense **only when `cleared`**.
- Cash payments count immediately.

### 7.5 Price resolution (at line creation, then frozen)
1. doctor-specific price for that work type, else
2. work type's general price.
The resolved price is stored in `case_items.unit_price` together with `work_type_name`. Later price edits never change existing lines.

### 7.6 Void, not delete
Payments, cheques, invoices: `status` + `void_reason` + `voided_at`. Cases: cancel with status «ملغاة» (never delete once saved). Every void/cancel/status change writes `audit_log`.

### 7.7 Numbering
Gap-free, monotonic, assigned in the same transaction as the insert: `case_no`, `invoices.no`, payments `IN-000001` / `OUT-000001`.

### 7.8 Integrity checks
- Amount > 0 for payments; ≥ 0 for prices; expected date ≥ received date.
- A case on an active invoice cannot be edited or cancelled.
- Incoming payment bound to a case must belong to the same doctor.
- **Idempotency:** payment and invoice creation endpoints accept an `Idempotency-Key`; replaying the same key returns the original result instead of creating a duplicate (unique constraint).
- **Optimistic concurrency:** mutable aggregates (cases, doctors, settings, work types) carry a `row_version`; updates must send it and receive 409 when stale.
- A settings-level «Manual financial audit» tool (hidden in Settings) that recomputes totals and reports mismatches is a nice-to-have (M7).

---

## 8. Data model

> Illustrative DDL in SQLite dialect. Translate to the database chosen in Phase 0 (e.g. PostgreSQL: `BIGINT`/`NUMERIC` money, `DATE`, `timestamptz`, partial unique indexes). **Add:** `users`, `roles`/permissions, `row_version` on mutable tables, `idempotency_key` (unique, nullable) on `payments` and `invoices`, `created_by`/`updated_by`, and `user_id` on `audit_log`. Money stays integer minor units unless Phase 0 justifies `NUMERIC(14,3)` with explicit rounding rules.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- schema_version, db_id
CREATE TABLE settings    (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- lab_*, currency_*, invoice_template(JSON)...

CREATE TABLE doctors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  phone TEXT, clinic TEXT, notes TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,      -- signed, minor units
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE technicians (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE work_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  unit_price INTEGER NOT NULL DEFAULT 0 CHECK (unit_price >= 0),  -- per tooth
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE doctor_prices (
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  work_type_id INTEGER NOT NULL REFERENCES work_types(id),
  price INTEGER NOT NULL CHECK (price >= 0),
  PRIMARY KEY (doctor_id, work_type_id)
);

CREATE TABLE cases (
  id INTEGER PRIMARY KEY,
  case_no INTEGER NOT NULL UNIQUE,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  patient_name TEXT NOT NULL,
  technician_id INTEGER REFERENCES technicians(id),
  received_date TEXT NOT NULL,
  expected_date TEXT NOT NULL,
  delivered_date TEXT,
  collect_on TEXT,                                  -- date to collect the unpaid rest after delivery
  status TEXT NOT NULL CHECK (status IN
    ('waiting','design','in_progress','ready','delivered','returned','cancelled')),
  notes TEXT,
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total INTEGER NOT NULL DEFAULT 0,                 -- cached = Σ items − discount
  invoice_id INTEGER REFERENCES invoices(id),       -- active invoice, null when none
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX ix_cases_doctor ON cases(doctor_id, received_date);
CREATE INDEX ix_cases_status ON cases(status, expected_date);
CREATE INDEX ix_cases_patient ON cases(patient_name COLLATE NOCASE);

CREATE TABLE case_items (                           -- one row per tooth per work line
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  tooth_no INTEGER NOT NULL CHECK (tooth_no BETWEEN 11 AND 48 AND tooth_no % 10 BETWEEN 1 AND 8),
  work_type_id INTEGER NOT NULL REFERENCES work_types(id),
  work_type_name TEXT NOT NULL,                     -- snapshot
  shade TEXT,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),  -- snapshot (may be overridden by hand)
  price_is_special INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX ix_items_case ON case_items(case_id);

CREATE TABLE case_status_history (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  from_status TEXT, to_status TEXT NOT NULL,
  at TEXT NOT NULL, note TEXT
);

CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  is_doctor INTEGER NOT NULL DEFAULT 0,             -- the «طبيب (استرداد)» category
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,                          -- IN-000001 / OUT-000001
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  doctor_id INTEGER REFERENCES doctors(id),         -- required for 'in'; for 'out' only when category.is_doctor
  case_id INTEGER REFERENCES cases(id),             -- optional binding (advance, delivery payment)
  category_id INTEGER REFERENCES expense_categories(id),  -- 'out' only
  payee TEXT,                                       -- 'out' free text
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','cheque')),
  paid_date TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  void_reason TEXT, voided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_pay_doctor ON payments(doctor_id, paid_date);
CREATE INDEX ix_pay_day ON payments(paid_date, direction);

CREATE TABLE cheques (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id),
  cheque_no TEXT NOT NULL,
  bank TEXT,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cleared','returned')),
  status_date TEXT
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  no INTEGER NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('cases','statement','free')),
  doctor_id INTEGER REFERENCES doctors(id),
  party_name TEXT,                                  -- free invoices / snapshot
  issue_date TEXT NOT NULL,
  reason TEXT,
  subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  void_reason TEXT, voided_at TEXT,
  snapshot_json TEXT NOT NULL,                      -- everything printed, frozen
  created_at TEXT NOT NULL
);

CREATE TABLE invoice_cases (
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  case_id INTEGER NOT NULL REFERENCES cases(id),
  PRIMARY KEY (invoice_id, case_id)
);

CREATE TABLE dismissed_notifications (key TEXT PRIMARY KEY, at TEXT NOT NULL);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  action TEXT NOT NULL,                             -- e.g. case.create, payment.void, invoice.create
  entity TEXT NOT NULL, entity_id INTEGER,
  summary_ar TEXT,                                  -- feeds «آخر العمليات»
  details_json TEXT
);
```

**Relationships:** `doctors 1─* cases 1─* case_items`, `cases 1─* case_status_history`, `doctors 1─* payments`, `payments 0..1─1 cheques`, `payments *─0..1 cases` (binding), `invoices *─* cases` via `invoice_cases` (a case in at most one **active** invoice; voiding an invoice deletes its `invoice_cases` rows and clears `cases.invoice_id`), `doctors 1─* doctor_prices *─1 work_types`.

---

## 9. Case lifecycle

```
          ┌──────────────┐
          │  بالانتظار    │  waiting   (received, nothing started)
          └──────┬───────┘
                 ▼
          ┌──────────────┐
          │ قيد التصميم   │  design    (default on creation)
          └──────┬───────┘
                 ▼
          ┌──────────────┐
          │ قيد التنفيذ   │  in_progress (milling / ceramics / finishing)
          └──────┬───────┘
                 ▼
          ┌──────────────┐
          │ جاهزة للتسليم │  ready     → appears in notifications by expected date
          └──────┬───────┘
                 ▼   (delivery dialog 5.7: optional payment, collect date)
          ┌──────────────┐        returned by doctor        ┌────────────────┐
          │  تم التسليم   │ ───────────────────────────────▶ │ مرتجعة للتعديل  │ returned
          └──────┬───────┘ ◀─────── fixed & re-delivered ─── └────────────────┘
                 ▼   (selected in «فاتورة حالات»)
           invoiced  (cases.invoice_id set)  →  fully paid when remaining = 0
                 
   ملغاة (cancelled): only before delivery and before invoicing.
```
- Any status can be set manually by the user (forward or back) with an optional note; **every change is logged** in `case_status_history`.
- **Owner decision (B2) — transitions:** waiting / design / in_progress / ready move freely among themselves and to delivered; delivered → returned only; returned → in_progress / ready / delivered. Cancel only before delivery and **final**. `delivered_date` is set (≥ received, ≤ today) only while delivered and cleared otherwise; every delivery date stays in the history. **Open item (B3):** whether a *returned* case may be cancelled, once payments exist.
- «invoiced» and «paid» are **derived facts**, not statuses: `invoice_id IS NOT NULL`, `remaining = 0`.
- The case is "closed" in lists when delivered + invoiced + remaining = 0 (show a «مغلقة» chip).
- Moving back from delivered to returned does not touch payments/invoices; if it is invoiced, the owner must void the invoice first before editing lines.

---

## 10. Reports (v1 — only these)
| Report | Where |
|---|---|
| Debts + per-doctor breakdown | «الديون» |
| Doctor account statement (printable, date range) | doctor account / «إنشاء فاتورة → كشف حساب» |
| Receipts report | «دفعة واردة» page |
| Expenses report (by category) | «إنشاء دفعة صادرة» page |
| Cases by status, overdue cases | Home / cases list |
| Done-not-invoiced cases | «إنشاء فاتورة» |
| Cheques due | Cheque register + notifications |
| Cash summary: cash received − cash paid in a period | Home card tooltip or Settings (low priority) |
All tables export to CSV (UTF-8 with BOM so Excel shows Arabic correctly).

---

## 11. Build plan

### Phase 0 — Assessment (no feature code)
Inspect the repo, then produce `docs/00-assessment.md`: stack proposal + justification, architecture and module boundaries, ERD, API outline, threat model, test strategy, deployment/backup options, and the open questions of §12. **Wait for the owner's approval.** Record decisions as short ADRs in `docs/adr/`.

### Phase 1 — Backend (complete before any frontend)
| # | Milestone | Done when |
|---|---|---|
| B0 | Repo skeleton, config, DB + migrations, CI, health, logging, error handling, OpenAPI, authentication (owner), audit-log foundation | Pipeline green, empty DB boots, login works |
| B1 | Doctors, technicians, work types, special prices, expense categories, settings | CRUD + validation + tests |
| B2 | Cases, case items, price resolution, status machine + history, numbering | Create/edit/search cases, rules enforced |
| B3 | Payments in/out/void, cheques, idempotency, balance engine (`allocate`, `doctorBalance`) | Exhaustive unit tests; numbers tie to hand calculations |
| B4 | Debts + breakdown, doctor statement, receipts/expenses reports, CSV export, global search | Breakdown ties out to the ledger |
| B5 | Delivery flow, cheque status transitions, notifications feed | Cheque rules (§7.4) verified |
| B6 | Invoices (3 types), immutable snapshots, void, template storage | Snapshot never changes after later edits |
| B7 | **Windows installer** (§2.1): bundled API + portable PostgreSQL as services, first-run setup, upgrade + rollback, scheduled backups & tested restore, uninstall that keeps data | Clean Windows VM: install → use → upgrade → restore works |
| B8 | Security review and hardening, index/query review, concurrency tests, frozen OpenAPI | **Backend sign-off by the owner** |

### Phase 2 — Frontend (starts only after B8 sign-off)
1. **Agree the look first:** colours, layout, typography, tooth-chart style. Use the `frontend-design` skill; show 2–3 visual directions; the owner picks. Update §1 with the decision.
2. Then build screens in this order: shell + login → home → add case (tooth chart) → doctors → payments → debts → cheques → invoices + appearance + printing → settings.
3. **Final installer:** rebuild the Windows installer so it includes the frontend; test install/upgrade/restore again on a clean Windows machine.

**A milestone is done only when** business logic, validation, authorization, tests (unit + integration + negative + concurrency where relevant) and docs are complete **and you actually ran** lint, typecheck, tests and build and report the real results. Never claim "tested" otherwise.

---

## 12. Decisions & open questions (defaults in bold — confirm with the owner)

> **Owner answers, 2026-11-06 (Phase 0):** currency **₪ ILS, 2 decimals** (6) · **no VAT** (13) · dues **from case creation** (4) · cheques count **only when cleared** (5) · Arabic lab name **«مختبر سمايل آرتك لتقنية الأسنان»** as the owner installation's setting (9) · case and invoice numbering **start at a number the owner chooses**, settable only before the first case/invoice (12 — changed from "1") · product name **not decided yet** (19) · **no import** of old data; use doctor opening balances · **one computer per installation** (API on localhost only) · **no backup encryption** in v1 · time zone = setting, initial value **taken from Windows at install**. Details: `docs/00-assessment.md` §2.
1. **Lab or clinic?** Built as a *lab serving doctors* (patient = name on the case, not a patient record). If the owner also wants direct patient accounts, we add a `patients` table later.
2. Technician: **plain lookup list per case**, no stages and no pay accounting (staff module was removed). Per-stage tracking (design/milling/ceramic) is out of v1.
3. Work type and material: **one list** («نوع العمل» such as «زيركون») with a price per tooth. A bridge = several teeth, one line per tooth.
4. Dues accrue **from case creation**; alternative: from delivery.
5. Cheque accounting §7.4 (**count only when cleared**); alternative: count on receipt.
6. **Single currency**, symbol chosen at first run (JOD? ILS? — ask).
7. Cancel-payment screen **kept** (it was in the original sidebar but not in the owner's list; the ledger needs a void path anyway). Easy to hide if the owner objects.
8. Delegates card, card hide/reorder: **not built**.
9. Arabic lab name unknown — **left empty, English name used**.
10. Brand colours are taken from the high-resolution logo; a vector (SVG) original is still welcome.
11. Authentication: **owner login required**, one role, RBAC-ready (§3.3).
12. Case numbering starts at **1** and is global (not per doctor).
13. Invoices carry **no tax** in v1 — ask whether VAT is required.
14. Print/PDF only; no e-mail/WhatsApp sending.
15. **Backend stack: NestJS + PostgreSQL — decided by the owner.**
16. **Runs on each customer's own Windows computer via an installer (§2.1); independent installation per computer — decided (§2.2).**
19. Product name `PRODUCT_NAME` — **owner is choosing**; until then use the placeholder through one constant (§2.3).
20. Licensing/subscription, auto-update and cloud are **out of v1** (§2.4).
17. **Invoice PDF:** backend returns snapshot + template JSON; rendering/printing is Phase 2 (alternative: server-side PDF).
18. **Patients** are not modelled (see 1) even though the engineering standards list them as a possible module; materials/inventory and employees are out of v1 (§3.2).
