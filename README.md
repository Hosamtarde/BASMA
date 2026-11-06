# Dental Lab Management System (product name TBD) — by Smile Artec Dental Laboratory

Backend-first (NestJS + PostgreSQL), shipped as a Windows installer. Start here:
1. `CLAUDE.md` (working rules) → 2. `ENGINEERING_STANDARDS.md` → 3. `SPEC.md` → `docs/00-assessment.md` and `docs/adr/`.

Layout: `apps/api` NestJS API · `assets/` brand files · `docs/` assessment & ADRs · `.claude/skills/` project skills · later `apps/web`.

## Run locally (development)
Requires Node 24 and Docker.
```
npm install
cp .env.example .env      # fill the empty values with random secrets (see comments in the file)
npm run db:up             # PostgreSQL 16 (dev only)
npm run dev               # http://127.0.0.1:4310/api/v1 · OpenAPI UI: http://127.0.0.1:4310/api/docs
```
First run: `POST /api/v1/setup` creates the owner account (works once), then `POST /api/v1/auth/login`.

## Checks (same as CI)
```
npm run lint && npm run typecheck && npm run i18n:check
npm test && npm run test:integration && npm run test:e2e   # integration/e2e start PostgreSQL via Testcontainers
npm run build
```
