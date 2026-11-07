# ADR-0016 — Frontend stack (F0)
Status: Accepted · 2026-11-07 (owner approval of the F0–F2 plan)

## Context
From B3 on, every milestone ships backend **and** frontend together (vertical slices, SPEC §11). The UI runs on the lab's own Windows computer behind the installer (SPEC §2.1), talks only to the local API, is Arabic RTL by default with English switchable (SPEC §6.1), and follows the approved look (direction A, SPEC §1.1).

## Decision
| Area | Choice | Why |
|---|---|---|
| App | **React 19 + Vite 8 + TypeScript 6.0** single-page app (`apps/web`) | No server rendering is needed on localhost; Vite's build is static files the API serves (ADR-0017). Same TS pin as the API (ADR-0015). |
| Routing | **React Router 8**, data router (`createBrowserRouter`), not framework mode | Normal URLs (back/forward, links to a case); the API has an SPA fallback. |
| Server state | **TanStack Query 5** | Caching, retries, invalidation after mutations; one query-key factory per feature. |
| API client | **openapi-typescript** (types only, dev) + **openapi-fetch** (runtime ~6 KB) | Types generated from `apps/api/openapi.json`; no hand-written API types. Hook generators (orval, hey-api) rejected: they own query keys and invalidation. CI fails when the committed types drift from the API. |
| Forms | **react-hook-form + zod 4 + @hookform/resolvers** | Form schemas are checked against the generated request types; the server stays the authority. |
| UI primitives | **Tailwind CSS 4** + shadcn/ui-style components copied into the repo, on **Radix** (`radix-ui`) | Accessible primitives (focus trap, ARIA, Esc). `DirectionProvider` makes menus and dialogs follow RTL. Light theme only. |
| Icons | **lucide-react** (ISC) | Owner decision: an open-source set, never the reference product's icons. |
| Toasts | **sonner** | Top-start corner, follows RTL/LTR. |
| i18n | **i18next + react-i18next**, `ar` default, `en` switchable | Plural-aware parity check (Arabic has six plural forms, English two). |
| Font | **Cairo** for both languages, imported from `assets/fonts/Cairo.ttf` (no second copy) | Owner decision; Cairo has Latin glyphs. |
| Tests | **Vitest + Testing Library + jsdom**; **Playwright + axe** | No MSW: openapi-fetch takes a custom `fetch`, so a typed stub is enough. |
| Lint | ESLint 10 flat config + **eslint-plugin-react-hooks** + **eslint-plugin-jsx-a11y** + a local rule against hard-coded text | Same "no literal strings" rule as the API. |

**Later slices** (approved, installed only when first used): `cmdk` (searchable pickers, F2) and `react-day-picker` (calendar, F2).

**Guards without packages:** RTL guard script (fails on physical classes like `ml-`, `pr-`, `left-`, `text-right`, `rounded-l`), i18n parity script, and the literal-text ESLint rule are local code.

### Versions (checked with `npm view` and `npm audit` on 2026-11-07)
Runtime: react / react-dom 19.3.1, react-router 8.5.1, @tanstack/react-query 5.107.1 (plan said 5.107.0), react-hook-form 7.91.0, @hookform/resolvers 7.0.3, zod 4.6.7 (already in the repo), i18next 26.7.2, react-i18next 17.1.13, openapi-fetch 0.17.0, radix-ui 1.8.1, sonner 2.0.8, class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0, lucide-react 1.70.0.
Dev: vite 8.3.6, @vitejs/plugin-react 6.2.1, tailwindcss / @tailwindcss/vite 4.3.5, openapi-typescript 7.13.0, vitest 5.1.0, jsdom 31.0.0, @testing-library/react 16.3.3, @testing-library/user-event 14.6.8, @testing-library/jest-dom 7.0.1, @playwright/test 1.65.0, @axe-core/playwright 4.14.0, eslint-plugin-react-hooks 7.1.1, eslint-plugin-jsx-a11y 6.10.2, @types/react / @types/react-dom 19.3.0.

Peer ranges older than our toolchain, resolved with npm `overrides` (no other package added):
- `openapi-typescript@7.13.0` declares `typescript ^5`; we use TypeScript 6.0. It is a dev-only code generator; the CI drift check proves its output.
- `eslint-plugin-jsx-a11y@6.10.2` (latest, 2024) declares `eslint ≤ 9`; we use ESLint 10. Its flat config runs on ESLint 10; `npm run lint` proves it.
- `@testing-library/dom` is a required peer of the Testing Library packages and is installed by npm automatically (not declared by us).

## Consequences
- The web app is ESM; `packages/shared` is an ESM package used by both the API (Node 24 `require(esm)`, ADR-0015) and the web app.
- Revisit the two overrides when those packages publish ranges for TypeScript 6 / ESLint 10.
- Every slice regenerates the client from `openapi.json`; a contract change is visible as a diff of the generated file.
