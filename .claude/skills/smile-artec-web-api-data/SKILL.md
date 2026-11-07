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

**Money**: integer minor units only, through `packages/shared` money (`parseMoney`, `formatMoney`, `toMoneyInput`; strings and BigInt, no floats; extra decimals are an error, never rounded). Forms use `moneySchema(decimals)` + `MoneyField`; the currency comes from `useCurrency()`. Balances and totals always come from the API.

**Lists and writes**: list state (search, status, page) in the URL via `useListParams` (built on `useUrlState`: controls answer at once, quick changes never overwrite each other, only complete values reach the address; `useLocalListParams` inside dialogs). Any new list with state in the address uses `useUrlState` too; PATCH only changed fields plus the `rowVersion` that was read; `*.name_taken` lands on the name field in the server's words; delete answers `deleted` or `deactivated` and the toast says which; after a write invalidate every family it touches (e.g. a price also invalidates `settings`, because amounts lock the currency).

**Pickers, dates, chained writes (F2)**
- Searchable choices use `EntityPicker` (cmdk in a Radix popover; trigger = select-only combobox named by the visible label). Its `queryKey` lives inside the entity's family (e.g. `[...doctorKeys.all, 'picker', search]`) so writes refresh it; the server searches active records only.
- Dates are `YYYY-MM-DD` strings end to end: `DateField` (masked text + react-day-picker popover, `today = todayIn(labTimeZone)`), `isIsoDate` for validation, `isoToLocalDate`/`localDateToIso` only for the calendar widget.
- Aggregates with `rowVersion` (cases): every write returns the whole aggregate; store it with `setQueryData` (`storeCase`) before the next call, so each call sends the version just returned. Actions come from the API (`allowedStatuses`, `canEdit`, `canCancel`); never re-implement the lifecycle.
- Previews are labelled previews (case prices and totals): send only what the user typed (a manual price), never a previewed price as truth.
- A dialog rendered inside a `<form>` bubbles its submit through the React tree (portals included): the outer form ignores `e.target !== e.currentTarget`.

**Counts and row actions (F2b)**
- Counts per status come from one `GET /cases/summary` (`caseCountsQuery`, same filters as the list except status and paging); `storeCase` invalidates `caseKeys.summaries` with the lists. Never count by paging through lists.
- Row actions read the API's verdict for that record when the menu opens (`CaseRowMenu` → `caseQuery`) and reuse the details-page dialogs (`CaseActionDialogs`); a whole-row click uses `useRowOpen` (ignores controls and portal events).
- An action the API does not allow now stays visible through `ActionButton` with `disabledReason` (aria-disabled, tooltip, accessible description); the reason text describes, it does not decide.
