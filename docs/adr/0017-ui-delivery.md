# ADR-0017 — How the UI ships inside the installer (F0)
Status: Accepted · 2026-11-07 (owner approval of the F0–F2 plan)

## Context
The product is one Windows installer that runs the API and PostgreSQL as services on the lab's own computer (SPEC §2.1, ADR-0011). The UI (ADR-0016) is a static single-page app. It must work offline, keep the refresh token in an httpOnly cookie (ADR-0004) and need no extra runtime.

## Decision
- **One service, one origin.** The API serves the built UI (`apps/web/dist`) when `WEB_DIST_DIR` is set, at `http://127.0.0.1:4310`:
  - hashed files under `/assets` are cached for a year, other files are revalidated (`no-cache`);
  - any other `GET` outside `/api` returns `index.html` (client routes survive a reload); missing files get a bare 404, unknown `/api` paths the JSON error envelope.
  - Same origin means no CORS, the SameSite=Strict cookie just works, and the CSP can be `'self'`.
- **Explicit CSP** for everything: `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (dialog libraries inject `<style>`), `img-src 'self' blob:` (the logo is fetched with a token and shown through an object URL), `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`. No `upgrade-insecure-requests` and no HSTS: the app is plain http on loopback.
- **Loopback only.** The API accepts only `127.0.0.1` or `::1` as `API_HOST` (one computer per installation). The UI uses `127.0.0.1`, not `localhost`, because `localhost` can resolve to `::1`.
- **App window.** The installer's shortcut runs `msedge --app=http://127.0.0.1:4310` (a window without browser chrome; Edge is on every Windows 10/11). **If Edge is missing, it opens the default browser** (owner decision). No Electron.
- **Development.** Vite on `:5173` proxies `/api` to `:4310`, so development is same-origin too. `WEB_DIST_DIR` stays unset.
- **CI / E2E.** The web-e2e job builds API and web, starts the API with `WEB_DIST_DIR=apps/web/dist` against a PostgreSQL 16 service, and runs Playwright against that single origin — the same shape as the installed product.
- **B7.** The installer copies `dist/` next to the API and sets `WEB_DIST_DIR`. An upgrade replaces both together, so UI and API versions never mix.

## Consequences
- The API process owns the UI's HTTP headers (CSP, cache); the web build must not rely on inline scripts or `data:` images (Vite `assetsInlineLimit: 0`).
- If the product ever moves to HTTPS or the cloud (SPEC §2.4), the cookie gains `Secure` automatically, HSTS can be enabled, and `API_HOST` needs a reviewed change (see `docs/production-readiness.md`).
