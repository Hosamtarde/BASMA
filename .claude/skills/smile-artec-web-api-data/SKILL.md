---
name: smile-artec-web-api-data
description: Use when the Smile Artec web app calls the API, caches server data, submits forms, handles errors, or touches tokens, money or rowVersion.
---
# API client and data rules (web)

**Client**
- Types are generated only: `apps/api/openapi.json` → `npm run api:generate` → `src/api/schema.gen.ts` (never edit). Call with `api.GET/POST/…` from `src/api/client.ts` and `unwrap()` → data, `ApiError` or `NetworkError`.
- Same origin always (`/api/v1/…`): Vite proxy in dev, the API serves the UI when installed (ADR-0017). No CORS, no absolute hosts.
- Endpoints that need the token for binary data (e.g. `GET /settings/logo`) are fetched as a blob (`parseAs: 'blob'`) and shown through an object URL revoked on change/unmount — never `<img src="/api/…">`.

**Session**
- Access token in memory only (`src/api/session.ts`). Refresh token = httpOnly SameSite=Strict cookie on `/api/v1/auth`; the UI never reads it.
- 401 → one single-flight refresh shared by all requests, one retry; a refused refresh ends the session (`session.onExpired` → login with a note). Never refresh for login/refresh/setup calls. Boot restores the session with one refresh.
- Sign-out: `POST /auth/logout`, then `session.clear()` and `queryClient.clear()`.

**Server state**
- TanStack Query; one key factory + `queryOptions` per feature; `useSuspenseQuery` inside routes with an error boundary.
- Mutations: invalidate exactly what changed; chain `rowVersion` from each response; never send client-computed totals, prices, balances or ids of ownership as truth.
- Retries: only `NetworkError` (once). `throwOnError` for 403/404/5xx while loading → the route's error boundary.

**Errors (approved F0 table)**
| Case | UI |
|---|---|
| 400 validation | inline field messages (`applyServerErrors` maps `details.fields`) + form alert with the server message |
| other 4xx business rules in a form | form alert with the server message (`meta: { inlineErrors: true }`) |
| 401 | silent refresh + retry, else login |
| 403 / 404 page load | dedicated page |
| 409 `error.concurrency.stale` | "changed elsewhere" dialog with reload |
| 429 | toast |
| 5xx | toast with the server message + copyable reference (correlation id) |
| API unreachable | full-width banner with "try again" (full page at boot) |
Every route has `errorElement: <RouteError />`.

**Money**: integer minor units only, formatted/parsed through one shared money module in `packages/shared` (half-up, no floats; it is added with the first screen that shows money, F1). Balances and totals always come from the API.
