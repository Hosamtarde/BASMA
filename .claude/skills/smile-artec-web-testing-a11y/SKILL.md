---
name: smile-artec-web-testing-a11y
description: Use when writing or reviewing tests or accessibility for the Smile Artec web app — which layer tests what, the axe and keyboard checklist, and the both-language smoke rule.
---
# Web testing and accessibility

**Layers**
- **Unit** (Vitest): pure logic — formatters, money, selection reducers, error mapping, session refresh (single flight), guard scripts (`scripts/*.test.ts`), the lint rule (`eslint-rules/*.test.ts`).
- **Component** (Vitest + Testing Library + jsdom): forms in Arabic (inline errors, `aria-invalid`, `toHaveAccessibleDescription`), server field errors, redirects, dialogs, keyboard. Stub the network with `stubApi()` from `src/test/render.tsx` (typed `fetch` stub; no MSW). Query by role and accessible name, not by test ids or label text with decorations.
- **E2E** (Playwright, `apps/web/e2e`): the built API serves the built UI on one origin with a fresh database (`apps/api/scripts/serve-e2e.cjs`, only `*_e2e` databases). Each test has a fresh browser (no cookie): sign in inside the test. `expectAccessible(page)` (axe, WCAG 2.1 A/AA) on every page reached. One smoke test per language that checks direction switching (SPEC §6.1).
- Run locally: `E2E_DATABASE_URL=postgres://…/lab_e2e npm run test:e2e:web` (local runs use installed Edge, CI uses Chromium).

**Accessibility checklist (every screen)**
- One `h1`; landmarks (`main`, labelled `nav`/`aside`); skip link works.
- Every control has a visible label; required = `aria-required` (the star is decorative and sits beside the label); errors linked by `aria-describedby`, `aria-invalid` set.
- Accessible name starts with the visible text (WCAG 2.5.3); icon-only buttons have a translated `aria-label`; decorative icons `aria-hidden`.
- Full keyboard path in RTL and LTR; visible focus ring; Esc closes dialogs (Radix), Enter submits forms; no `autoFocus`.
- Contrast AA: text uses ink/muted/cyan-ink tokens, never logo cyan; third-party widgets restyled if axe flags them (Sonner rich colours did).
- Status/alerts: `role="alert"` for errors, `role="status"` for progress; toasts are not the only place important info lives.

**Report**: real command output only; list what was verified by test vs by reading.
