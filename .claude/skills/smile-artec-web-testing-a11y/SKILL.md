---
name: smile-artec-web-testing-a11y
description: Use when writing or reviewing tests or accessibility for the Smile Artec web app — which layer tests what, the axe and keyboard checklist, and the both-language smoke rule.
---
# Web testing and accessibility

**Layers**
- **Unit** (Vitest): pure logic — formatters, money, selection reducers, error mapping, session refresh (single flight), guard scripts (`scripts/*.test.ts`), the lint rule (`eslint-rules/*.test.ts`).
- **Component** (Vitest + Testing Library + jsdom): forms in Arabic (inline errors, `aria-invalid`, `toHaveAccessibleDescription`), server field errors, redirects, dialogs, keyboard. Stub the network with `stubApi()` from `src/test/render.tsx` (typed `fetch` stub; no MSW). Query by role and accessible name, not by test ids or label text with decorations.
- **E2E** (Playwright, `apps/web/e2e`): the built API serves the built UI on one origin (`apps/api/scripts/serve-e2e.cjs`, only `*_e2e` databases, created if missing and reset at start). Two projects, each with its own database: **first-run** (empty installation; only `first-run.spec.ts`, serial — for things that happen once: setup, currency lock after the first amount, numbering lock after the first case, password change) and **app** (owner seeded at start). **No test may depend on another test or file:** each test signs in (`signedIn`), sets the language it checks (`setLanguage`), creates its own data with `uid()` names (seed through the real API with `apiToken`/`apiPost`), and restores shared installation state it changes (e.g. removes the logo it uploaded). Check by running a file alone: `npx playwright test e2e/<file>.spec.ts --project=app`. `expectAccessible(page)` (axe, WCAG 2.1 A/AA) on every page reached. One smoke test per language that checks direction switching (SPEC §6.1).
- jsdom has no layout: `src/test/setup.ts` stubs `ResizeObserver`, `scrollIntoView` and pointer capture (cmdk, Radix, chart). Layout facts (the chart fits at 1366×620 and 1280×560, badge size, no sideways scroll) are checked in Playwright with `getBoundingClientRect`.
- Screens with sticky parts are captured as the user sees them: `shot(page, name, { fullPage: false })`.
- Run locally: `E2E_DATABASE_URL=postgres://…/lab_e2e npm run test:e2e:web` (local runs use installed Edge, CI uses Chromium).

**Accessibility checklist (every screen)**
- One `h1`; landmarks (`main`, labelled `nav`/`aside`); skip link works.
- Every control has a visible label; required = `aria-required` (the star is decorative and sits beside the label); errors linked by `aria-describedby`, `aria-invalid` set.
- Accessible name starts with the visible text (WCAG 2.5.3); icon-only buttons have a translated `aria-label`; decorative icons `aria-hidden`.
- Full keyboard path in RTL and LTR; visible focus ring; Esc closes dialogs (Radix), Enter submits forms; no `autoFocus`.
- Contrast AA: text uses ink/muted/cyan-ink tokens, never logo cyan; third-party widgets restyled if axe flags them (Sonner rich colours did).
- Status/alerts: `role="alert"` for errors, `role="status"` for progress; toasts are not the only place important info lives.

**Playwright notes (F2b)**
- Names shared by the sidebar and Home cards (`الأطباء`, `إضافة حالة جديدة`): match nav links with `exact: true` or scope to `getByRole('complementary')`.
- Playwright never clicks an `aria-disabled` element (it waits): use `click({ force: true })` to prove a disabled card does nothing.
- Toasts pause while hovered and dim when stacked (axe flags them): move the mouse away and wait for `[data-sonner-toast]` to be gone before `expectAccessible` or a report screenshot.
- Column alignment is a layout fact: compare the text edges (`startEdge`/`textEdges` in `e2e/support.ts`) of a header and its cell in both languages.
- Counts in a shared installation: compare `GET /cases/summary` before and after seeding, never absolute numbers; the empty Home is checked in `first-run.spec.ts`.
- Counts that must be exact (Home with realistic data) belong to the `demo` project (`home-demo.spec.ts`): its own database, filled by the demo seed before the port opens.
- Blur the focused element before a report screenshot taken after a keyboard check.

**Report**: real command output only; list what was verified by test vs by reading.

**B4b notes**
- Four Playwright projects now: first-run, **first-run-outgoing** (a second empty installation, for the currency lock caused by the first OUTGOING payment, which the first-run file cannot show once its own price exists), app, demo. `readDownload(download)` in `e2e/support.ts` reads a CSV (BOM, rows, file name).
- Filter changes replace the address (they do not push): test "Back" by leaving the page and coming back, not by `goBack()` after a chip.
- `FormDialog` returns the focus to the control that opened it (it remembers the opener; Radix has no trigger there). Assert `toBeFocused()` after Esc for any new dialog.
- Where a figure exists in two places (Home vs the expenses report), compare it with the OTHER endpoint's number, not with the same endpoint twice.
- **Vitest runs from any shell (fixed in B5).** The cause was a working directory spelled with a lower-case drive letter (`c:\…`, Git Bash `/c/…`): Vitest loaded itself twice and every jsdom suite failed with "Vitest failed to find the current suite". `npm test` now starts Vitest through `scripts/vitest.ts`, which upper-cases the drive letter. Calling `npx vitest` directly from such a shell still fails; use `npm test -- <files>`.

**B5 notes**
- Signed in, a language button click is saved by a request that follows: use `switchLanguage(page, /^English/)` from `e2e/support.ts` when a later test depends on the saved language (it waits for `PATCH /settings/language`, no sleep).
- No sleeps: wait for a layout fact with `expect.poll` (the chart test after scrolling), for a request with `waitForResponse`.
- Component tests have no Toaster: spy on `toast.success` (`vi.spyOn(toast, 'success')`) and assert the text it was called with.
- Timeouts: Vitest `testTimeout` 15 s and Testing Library `asyncUtilTimeout` 4 s (heavy screens under a parallel run); a hung test still fails.
- The bell lists the whole installation's feed (20 items per type): a Playwright test looks for its own case's item (`تحصيل مستحق` has few), or compares `GET /notifications/count` before and after marking everything read.

**B5b notes**
- `e2e/responsive.spec.ts` visits every route at 390×844 in both languages: no sideways page scroll (`documentElement.scrollWidth <= clientWidth`), axe, the bell panel inside the screen; then the lists at 1366 px (a table fits its card). A new route is added to its `routes()` list.
- Screens are code-split (React Router `lazy`): a test that renders `routes` must `await` the screen (`findBy…`), and a new page is exported by name and registered with `page(() => import(...), 'Name')`.
- `shot()` has no sleep: it waits for fonts and two painted frames.
- A row that repeats a control of the guide below it (the shade guide's «الأكثر استخدامًا» row) makes `getByRole('button', { name: 'A2' })` ambiguous: scope to `getByRole('tabpanel')` or to the row's `region`.
- Audit entries are global to the installation (a language switch writes one): find your own entry by its label, never by position.
- Queries that feed a side panel use `throwOnError: false` and render their own error and retry.
