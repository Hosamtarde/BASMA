# Product editions

One codebase ships two branded editions of the same app. Decision record: [ADR-0018](adr/0018-product-editions.md).

| Edition id | Who it is for | Product name shown |
|---|---|---|
| `smile-artec` | Smile Artec Dental Laboratory (owner: Ibrahim Al-Tarda), the main lab | Smile Artec product branding |
| `generic` | Other labs that buy the product | `{{PRODUCT_NAME}}` — placeholder, final name not decided |

Status: **documented, not implemented.** Implementation is slice **E1** below. Until then the app has one product identity: the `PRODUCT_NAME` constant in `packages/shared/src/product.ts` (placeholder value).

## The two levels of branding

| | A) Lab branding | B) Product branding |
|---|---|---|
| When it is set | **Runtime** | **Build time** |
| Status | Already implemented | To be implemented (E1) |
| What | Lab logo, lab name (AR/EN), slogan | Product name, browser tab title, window title, installer name and icon, About/licence screen text, default logo shown before a lab uploads one |
| Where it lives | Lab profile in `settings` (database) | One branding module in `packages/shared`, selected by `EDITION`; text in the i18n catalogs |
| Who changes it | Each customer, in Settings | Us, by choosing the edition when building |
| Rebuild needed | No | Yes (a different installer) |
| Shown on printed documents | Yes (invoices, statements, receipts) | No |
| Differs per edition | No — same feature in both | Yes |

Rules that hold in both editions (SPEC §2.3):

- Printed documents show only the **lab's** logo and name. Without an uploaded logo they show the lab name only — never the Smile Artec logo and never a product logo.
- The edition's default logo (level B) is for the app's own screens (e.g. login, sidebar placeholder) before a lab uploads its logo; once a lab logo exists, the lab logo wins.
- A Smile Artec installation built from `generic` is still possible: lab branding alone (level A) makes it look like Smile Artec on documents; the edition only changes the product identity around it.

## Proposed `EDITION` mechanism

1. **Build variable.** `EDITION=smile-artec | generic`, read once when building (web: Vite build; shared package: build step; installer: packaging script). An unknown value fails the build. The default when unset is decided in E1 (proposal: `generic`, so nothing ships with Smile Artec product branding by accident).
2. **One branding module** (proposed `packages/shared/src/branding/`):
   - `editions/smile-artec.ts` and `editions/generic.ts`, each exporting the same typed shape, e.g. `{ id, i18nKeys: { productName, windowTitle, about, licence }, installer: { exeName, iconPath, appId }, defaultLogoPath }`.
   - `index.ts` exports the selected `BRANDING` object (and keeps `PRODUCT_NAME`-style helpers for current callers during migration).
   - No other file names an edition.
3. **Text in the catalogs.** Display text is in `apps/web/src/i18n/{ar,en}.json` and `apps/api/src/shared/i18n/catalogs/{ar,en}.json` under edition-scoped keys (e.g. `edition.smile-artec.productName`, `edition.generic.productName`), Arabic default, English switchable. `i18n:check` covers both editions' keys in both languages. The generic product name is `{{PRODUCT_NAME}}` until the owner decides.
4. **Assets.** Edition icons and default logos sit under `assets/editions/<edition>/` (raster logos never enlarged past native size, SPEC §1). The Smile Artec assets in `assets/` stay the source for the `smile-artec` edition.
5. **Consumers.** Web: tab title, window title, login/About screen. API: OpenAPI title, About/version endpoint if one is added. Installer (B7): file name, icon, shortcut name, Add/Remove Programs entry.

## What differs per edition

- Product name (AR/EN)
- Browser tab title and app-window title (ADR-0017 `--app` window)
- Installer file name, icon, Start-menu shortcut name, Add/Remove Programs name, Windows app id
- About / licence screen text
- Default logo shown in the app before a lab uploads its own
- Vendor credit line («Powered by Smile Artec Dental Laboratory», SPEC §2.3): same in both editions unless the owner decides otherwise

## What must be identical

- All features and screens (SPEC §3.1) — no edition-only features
- Database schema and migrations
- API contract (`openapi.json`) except its title
- Business rules, money rules, permissions
- Test suites (plus one small branding test per edition)
- Lab branding behaviour (level A)
- Licensing seam (ADR-0013)

## Future slice — E1: editions implementation

Branch `feat/e1-editions`; stops for the owner's go-ahead like every slice.

### Tasks

1. Add the branding module in `packages/shared` with the two edition files and a typed shape; fail the build on an unknown `EDITION`.
2. Move `PRODUCT_NAME` users (`apps/api/src/openapi.ts`, `apps/web/src/main.tsx`, `apps/web/src/features/auth/AuthLayout.tsx`) to the branding module.
3. Add edition-scoped keys to the web and API catalogs in Arabic and English; keep `i18n:check` green.
4. Wire `EDITION` into the web build (tab title, window title, login/About text, default logo) and the API build (OpenAPI title).
5. Add edition assets under `assets/editions/<edition>/` (icon, default logo); `generic` uses a neutral placeholder mark.
6. Add an About/licence screen if not yet present (strings from the catalogs only).
7. Add a CI check that fails if an edition id or an edition product name appears outside the branding module, its catalog keys and `assets/editions/`.
8. CI: build both editions (matrix on `EDITION`); run tests once plus the per-edition branding test.
9. Installer (B7, or E1 if B7 has landed): read installer name, icon and app id from the branding module.
10. Update `README.md` with how to build each edition; add screenshots of both login screens (AR/EN) to `docs/screenshots/e1/`.

### Acceptance criteria

- `EDITION=smile-artec` and `EDITION=generic` both build (lint, typecheck, tests, build all green).
- Each installer shows the right product name, icon and window/tab title; `generic` shows `{{PRODUCT_NAME}}` (or the final name once decided).
- No edition string outside the branding module, its catalog keys and edition assets (CI check passes, and fails on a planted violation).
- CI builds both editions on every pull request.
- Lab branding (logo, name, slogan) behaves the same in both editions; printed documents never show a product or Smile Artec logo for a lab without one.
- Same schema and migrations in both editions (one migration set, no edition branches in migration code).
