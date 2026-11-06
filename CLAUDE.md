# CLAUDE.md — Dental Lab Management System (product name TBD · built by Smile Artec Dental Laboratory)

## Read first, in this order
1. `ENGINEERING_STANDARDS.md` — how we engineer (architecture, security, testing, workflow). Binding.
2. `SPEC.md` — what we build (scope, rules, data model, milestones). Source of truth for business behaviour.
3. `.claude/skills/` — project skills; load the matching one before each kind of task.

Precedence: **business scope → SPEC.md wins** (the standards list *possible* modules; we build only SPEC §3.1). **Engineering quality → the standards win.**

## The plan in one paragraph
We build the **whole backend first** (Phase 1, milestones B0–B8), get the owner's sign-off, **and only then** start the frontend (Phase 2). Do not scaffold, design or discuss UI in Phase 1. When Phase 2 starts, the first step is agreeing the look (colours, layout) with the owner — use the `frontend-design` skill (enable Anthropic's frontend-design skill/plugin if it is not active), propose 2–3 directions, let the owner choose.

## Your first task — Phase 0 only (no feature code)
1. Inspect the repo as it is now (it may be nearly empty — say so).
2. Write `docs/00-assessment.md`: stack is already decided (NestJS + PostgreSQL) — document the remaining choices as ADRs, module boundaries, ERD, API outline, threat model, test strategy, deployment/backup options.
3. Ask the owner the open questions of SPEC §12 that block B0–B2 — **in Arabic, short, numbered, with your recommended default** — especially: the product name (SPEC §2.3), currency symbol/decimals, Arabic lab name, VAT yes/no, dues from case creation vs delivery.
4. Stop and wait for approval. Then start B0.

## References
`docs/reference/invoice-sample.{html,pdf,png}` — approved starting look of the printed invoice (Phase 2); Phase 1 must produce snapshot data that supports it (SPEC §5.14). Font: `assets/fonts/Cairo.ttf` (OFL).

## Delivery requirement
The system must ship as a **single Windows installer** that installs the API + portable PostgreSQL as Windows services (SPEC §2.1). Docker is for development only. Keep every design choice compatible with this from day one (config, paths, ports, secrets, backups, migrations).

## Distribution model (decided)
Each customer installs the product independently on its own computer, with its own local owner account and its own data (SPEC §2.2). Single-tenant per install; nothing lab-specific hard-coded. Licensing, auto-update and cloud are **not** in v1 — keep the seams clean (SPEC §2.4) and note pre-production tasks in `docs/production-readiness.md`.

## Working agreement
- Talk to the owner in simple Arabic (Palestinian-friendly), short and practical; he is not a programmer. Code, identifiers, comments, commits, docs: English. **Arabic is the default language and English must be switchable (SPEC §6.1):** all user-facing text lives only in the `ar.json`/`en.json` catalogs (API now, frontend later) — never hard-coded; every new string is added to both languages; the DB stores codes, not translated labels.
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
- This product is a **behavioural** re-implementation of workflows the owner knows from another dental program. Do not look for, copy or reuse that product's code, images, icons or texts. Original code and original assets only. Brand assets of the owner's lab (Smile Artec — the vendor / main lab, **not** the product name) are in `assets/` (transparent PNG logos from a high-resolution source — never enlarge past native size; the logo path is a setting). The product name is still being chosen by the owner: use one `PRODUCT_NAME` constant everywhere (SPEC §2.3); the repo/folder name `smile-artec` is temporary.

## Commands (run from the repo root; Node 24, Docker for the dev DB and for integration/e2e tests)
```
cp .env.example .env        # then fill POSTGRES_PASSWORD, DATABASE_URL, JWT_ACCESS_SECRET (random values)
npm run db:up               # PostgreSQL 16 in Docker (development only)
npm run dev                 # API on http://127.0.0.1:4310 (migrates on start); OpenAPI UI at /api/docs
npm run lint · typecheck · i18n:check · test · test:integration · test:e2e · build
npm run migrate             # apply migrations explicitly (installer path: MIGRATE_ON_START=false)
npm run db:generate -w apps/api -- --name <name>   # new migration from the Drizzle schema; review the SQL
```
- Never add "Co-Authored-By", "Claude-Session" or any Claude/AI attribution lines to commit messages or pull request descriptions (owner's preference).