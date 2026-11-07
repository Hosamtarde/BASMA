---
name: smile-artec-web-feature-workflow
description: Use when building or changing any screen of the Smile Artec web app (apps/web), or a vertical slice that ships backend and frontend together. Runs the slice loop from contract to screenshots and enforces the frontend definition of done.
---
# Web slice workflow (vertical slices, SPEC §11)

Every milestone ships its API **and** its screens. Load with this skill: `smile-artec-web-rtl-i18n`, `smile-artec-web-api-data`, `smile-artec-web-testing-a11y`; for the backend half `smile-artec-feature-workflow`; for anything visual `frontend-design` and the approved look (SPEC §1.1, `docs/design-directions/a-brand-gradient.html`).

## Loop
1. **Contract first.** Read SPEC for the screen. If the UI would have to re-implement a server rule (allowed transitions, locks, totals), add a field to the API instead (example: `allowedStatuses`, `canCancel`, `canEdit`). Change DTOs → `npm run openapi:export` → `npm run api:generate` → commit both files. CI fails on drift.
2. **Data.** Query-key factory + `queryOptions` per feature (`features/<x>/api.ts`); mutations invalidate exactly what they change; chain `rowVersion` from each response.
3. **UI.** Feature folder `src/features/<x>/` (routes · components · api · schema · tests). Primitives from `src/components/ui`. Layout = direction A tokens (`src/design/tokens.css`); no new colours without a token.
4. **Text.** Every string in `ar.json` **and** `en.json` in the same commit; plural keys with all forms; no literals in JSX (lint fails).
5. **Navigation.** A sidebar item appears only when its screen works (no dead items, SPEC §3.2).
6. **Tests.** Unit (pure logic) · component (form errors in Arabic, server field errors, keyboard) · Playwright flow with axe in both languages.
7. **Run everything** and report real output: `npm run lint · typecheck · i18n:check · rtl:check · test · build`, `npm run contract:check`, `npm run test:e2e:web` (needs `E2E_DATABASE_URL` to a `*_e2e` database).
8. **Screenshots** of each new screen in Arabic and English (`E2E_SHOTS_DIR=… npm run e2e -w apps/web`; `shot(page, name)` in the specs), summary for the owner in ≤ 5 Arabic lines, then stop.

## Definition of done (per slice)
Screens match SPEC · all strings in both catalogs · RTL and LTR checked · keyboard works, axe clean · unit/component/E2E green · lint, typecheck, i18n, RTL guard, build, drift check run with real results · screenshots in both languages · docs and skills updated · owner go-ahead before the next slice.

## Never
Hand-written API types · tokens in localStorage · `dangerouslySetInnerHTML` · physical CSS (ml-/left-/text-right) · money as float (use `packages/shared` money, integer minor units) · client-computed balances or totals sent as truth · Al-Ekhlas code, images, icons or texts.
