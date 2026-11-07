# ADR-0018 — Product editions: one codebase, two branded builds

Status: Accepted, implementation deferred (slice E1) · 2026-11-07

The product name is now "Basma" (بسمة); until a second edition is actually needed, a single central product-name constant is enough (see `chore/product-name-basma`).

## Context

The same application has to ship as two branded installers:

- **`smile-artec`** — the installer for Smile Artec Dental Laboratory (owner: Ibrahim Al-Tarda), the main lab that builds and first uses the product.
- **`generic`** — the edition sold to other labs under our own product name, «Basma» (بسمة) (SPEC §2.3, §12 #19).

There are two different kinds of branding, and they must not be mixed up:

1. **Lab branding (runtime, already built).** Lab logo, lab name (AR/EN) and slogan live in the lab profile (`settings`) and each customer edits them in Settings. They appear on the home banner, the sidebar and printed documents. No rebuild is needed. SPEC §2.3 still applies: without an uploaded logo, documents show the lab name only — never the Smile Artec logo.
2. **Product branding (build-time, not built yet).** Product name, browser tab title, window title, installer name and icon, About/licence text, and the default logo shown in the app before a lab uploads its own. Today this is a single constant, `PRODUCT_NAME = 'Basma'` in `packages/shared/src/product.ts`, shown on screen through the `app.productName` i18n key (بسمة / Basma), with no notion of editions.

Some of the product identity cannot be decided at runtime: the installer file name, its icon, the Start-menu shortcut and the window/tab title exist before the app has read any setting.

## Decision

- **One repository, one codebase, one schema.** Editions differ only in product branding.
- An **`EDITION` build variable** (`smile-artec` | `generic`) selects the edition. It is read once at build time and feeds **a single branding module** in `packages/shared` (proposed `packages/shared/src/branding/`), which replaces the bare `PRODUCT_NAME` constant. The API, the web app and the installer scripts read product identity only from that module.
- **Text stays in the i18n catalogs.** The branding module holds identifiers, asset paths and i18n keys — not display text. Product name, tab/window title and About/licence text live in `ar.json`/`en.json` (Arabic default, English switchable, SPEC §6.1) under edition-scoped keys, so both languages are checked by `i18n:check`. Build-time consumers (installer) read the same catalogs.
- **Lab branding is untouched.** It stays runtime data in the lab profile, identical in both editions.
- **No edition string outside the branding module** (and its catalog keys and assets). This is enforced by a check in CI, in the same spirit as the existing `no-literal-text` lint rule.
- **CI builds both editions** on every change.

## Consequences

- Features, database schema, migrations and tests are identical across editions; a fix ships to both by construction. Data is portable between editions (same schema), so a lab could move from one installer to the other.
- One more build axis: CI time roughly doubles for the build/packaging job (tests run once; they do not depend on the edition except for a small branding test per edition).
- The current `PRODUCT_NAME` constant becomes a thin re-export (or is replaced) during E1; its existing users (`openapi.ts`, and the `app.productName` i18n key used by `AuthLayout.tsx` and `i18n.ts`) move to the branding module.
- The product name is decided: «Basma» (بسمة). The resale licence terms and the ownership agreement remain open decisions (`docs/production-readiness.md`); neither blocks E1.
- Licensing/activation stays behind the `LicenseService` seam (ADR-0013); editions do not imply different licence logic.

## Alternatives considered

- **Separate repositories or long-lived forks per edition — rejected.** Every feature and fix would be done twice and the copies would drift (double maintenance, risk of a money-rule fix reaching only one edition).
- **Runtime-only switch (a setting or a flag in the database) — rejected.** The installer name and icon, the Start-menu shortcut and the browser tab/window title are needed before any setting is read; a runtime switch would also let a customer turn one edition into the other.
- **Long-lived edition branches — rejected** for the same reasons as forks.
- **Separate per-edition copies of the catalogs — rejected.** Only a handful of keys differ; one catalog per language with edition-scoped keys keeps `i18n:check` simple and avoids duplicating hundreds of identical strings.
