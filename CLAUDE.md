# CLAUDE.md — Basma (بسمة), a dental lab management system · built by Smile Artec Dental Laboratory

## Read first, in this order
1. `ENGINEERING_STANDARDS.md` — how we engineer (architecture, security, testing, workflow). Binding.
2. `SPEC.md` — what we build (scope, rules, data model, milestones). Source of truth for business behaviour.
3. `.claude/skills/` — project skills; load the matching one before each kind of task.

Precedence: **business scope → SPEC.md wins** (the standards list *possible* modules; we build only SPEC §3.1). **Engineering quality → the standards win.**

## The plan in one paragraph
B0–B2 were built backend-first. The look is agreed (direction A, SPEC §1.1, `docs/design-directions/`). **From F0 on we work in vertical slices: every milestone delivers its backend and its screens together** (SPEC §11): F0 web foundation, F1 screens for B1, F2 screens for B2, then B3–B8 each with their UI. Each slice gets its own branch and stops for the owner's go-ahead. Frontend stack: ADR-0016; how the UI ships inside the installer: ADR-0017. Load the `smile-artec-web-*` skills for frontend work and `frontend-design` for visual work.

## Your first task — Phase 0 only (no feature code)
1. Inspect the repo as it is now (it may be nearly empty — say so).
2. Write `docs/00-assessment.md`: stack is already decided (NestJS + PostgreSQL) — document the remaining choices as ADRs, module boundaries, ERD, API outline, threat model, test strategy, deployment/backup options.
3. Ask the owner the open questions of SPEC §12 that block B0–B2 — **in Arabic, short, numbered, with your recommended default** — especially: the product name (SPEC §2.3), currency symbol/decimals, Arabic lab name, VAT yes/no, dues from case creation vs delivery.
4. Stop and wait for approval. Then start B0.

## References
`docs/reference/invoice-sample.{html,pdf,png}` — approved starting look of the printed invoice (built in B6); the backend must produce snapshot data that supports it (SPEC §5.14). Font: `assets/fonts/Cairo.ttf` (OFL).

## Delivery requirement
The system must ship as a **single Windows installer** that installs the API + portable PostgreSQL as Windows services (SPEC §2.1). Docker is for development only. Keep every design choice compatible with this from day one (config, paths, ports, secrets, backups, migrations).

## Distribution model (decided)
Each customer installs the product independently on its own computer, with its own local owner account and its own data (SPEC §2.2). Single-tenant per install; nothing lab-specific hard-coded. Licensing, auto-update and cloud are **not** in v1 — keep the seams clean (SPEC §2.4) and note pre-production tasks in `docs/production-readiness.md`.

Editions: one codebase ships two branded installers (`smile-artec`, `generic`) — see `docs/editions.md` (ADR-0018).

## Working agreement
- Talk to the owner in simple Arabic (Palestinian-friendly), short and practical; he is not a programmer. Code, identifiers, comments, commits, docs: English. **Arabic is the default language and English must be switchable (SPEC §6.1):** all user-facing text lives only in the `ar.json`/`en.json` catalogs (API: `apps/api/src/shared/i18n/catalogs`, web: `apps/web/src/i18n`) — never hard-coded; every new string is added to both languages; the DB stores codes, not translated labels.
- After every milestone: run lint + typecheck + tests + build, report **real** results (never claim tested otherwise), summarise in ≤5 Arabic lines, and wait for the go-ahead.
- No features outside SPEC §3.1. No dead endpoints for §3.2. When you must assume something, take the SPEC §12 default, say so in one line, keep it easy to change.
- One logical change per commit (conventional commits). Don't modify unrelated modules; don't rewrite working code without a reason.
- **No AI attribution in commits or PRs** (owner preference): no `Co-Authored-By`, `Claude-Session` or any Claude/AI signature lines in commit messages or PR descriptions.
- Don't add a dependency without explaining why it is needed.

## Non-negotiables (details in SPEC §7 and the skills)
- **Money = integer minor units**, one shared money module, explicit rounding; no floats anywhere.
- **Balances are computed, not stored** (`allocate`, `doctorBalance` pure functions, heavily tested).
- **Never delete financial records** — void with reason + audit entry. **Invoices are immutable**, rendered from a stored snapshot.
- Idempotency keys on payment/invoice creation; optimistic concurrency (`row_version`) on mutable aggregates; gap-free numbering assigned inside the insert transaction.
- Every write: validated DTO → application service → one DB transaction. Authorization checked on the server for every endpoint. Never trust client-supplied prices, balances, totals, roles or ids of ownership.
- No entities in API responses; no secrets in code or logs; no stack traces to clients.
- This product is a **behavioural** re-implementation of workflows the owner knows from another dental program. Do not look for, copy or reuse that product's code, images, icons or texts. Original code and original assets only. Brand assets of the owner's lab (Smile Artec — the vendor / main lab, **not** the product name) are in `assets/` (transparent PNG logos from a high-resolution source — never enlarge past native size; the logo path is a setting). The product name is **Basma** (Arabic «بسمة»), decided by the owner (SPEC §2.3). It is defined once: `PRODUCT_NAME` in `packages/shared/src/product.ts` (technical name: API title, installer, file names) and the `app.productName` key in `apps/web/src/i18n/{ar,en}.json` for everything shown on screen (a unit test keeps the English value equal to the constant). Never hard-code the name elsewhere. The product logo is `assets/brand/basma-logo-800.png` (signed-out footer) with a 64 px copy `basma-logo-64.png` (favicon) — only there — never the lab logo, never on printed documents. The repo/folder name `smile-artec` is temporary.

## Commands (run from the repo root; Node 24, Docker for the dev DB and for integration/e2e tests; `npm install` also builds packages/shared)
```
cp .env.example .env        # then fill POSTGRES_PASSWORD, DATABASE_URL, JWT_ACCESS_SECRET (random values)
npm run db:up               # PostgreSQL 16 in Docker (development only)
npm run dev                 # API on http://127.0.0.1:4310 (migrates on start); OpenAPI UI at /api/docs
npm run lint · typecheck · i18n:check · test · test:integration · test:e2e · build
npm run migrate             # apply migrations explicitly (installer path: MIGRATE_ON_START=false)
npm run db:generate -w apps/api -- --name <name>   # new migration from the Drizzle schema; review the SQL
npm run dev:web             # web UI on http://127.0.0.1:5173 (proxies /api to the API)
npm run rtl:check           # web: logical CSS only (i18n:check covers both API and web catalogs)
npm run contract:check      # export openapi.json + regenerate the web client; fails on drift
npm run test:e2e:web        # build all, then Playwright + axe; needs E2E_DATABASE_URL to a *_e2e database
                            # (E2E_BROWSER=chromium for Playwright's Chromium locally; retries stay off locally)
npm run demo                # dev only: build, then the app with fictional demo data on :4330 (needs DEMO_OWNER_PASSWORD in .env)
npm run seed:demo -w apps/api   # dev only: demo data into an EMPTY *_demo / *_e2e database (DEMO_DATABASE_URL)
```
