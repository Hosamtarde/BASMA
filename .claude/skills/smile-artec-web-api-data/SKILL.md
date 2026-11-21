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

**Money screens (B3)**
- Every payment form holds one `Idempotency-Key` per attempt (`features/payments/PaymentForm.tsx`): the same request again (retry, double click) reuses it, a changed request gets a new one; the key is dropped after success. The add-case form does the same when it carries an advance (`advance` needs the key, a plain case does not).
- After any money write call `refreshMoney(queryClient)` (payments, cheques, debts, balances, statements, Home summary, cases, settings — amounts lock the currency). Never compute a balance, "counted", paid or remaining in the browser: `counted`, `allowedStatuses` (cheques), `dueState`, `doctorBalance`, `paid`/`remaining` all come from the API.
- Row actions on money (void, cheque status) stay visible through `ActionButton` with the API's reason; amounts show without a sign, the direction is a word («مستحق لي / عليّ»), never colour alone.
- Filters of Payments, Cheques and Debts live in the address through `useUrlState`; a native `<select>` filter uses `FilterSelect` (label bound by `htmlFor`, so its name is the label only).

**Outgoing money screens (B4b)**
- `features/outgoing/` holds the page (`OutgoingPage`), `OutgoingForm` (also the refund dialog of a doctor: `refundDoctor` fixes the category and the doctor), `ExpensesSummary`, `CashFlowPanel`. One key family `outgoingKeys` (`['outgoing', …]`); `refreshMoney` (payments/api.ts) invalidates it and the expense-categories family, so the list, the summary, the cash flow and the category picker move together after any money write.
- The category decides the party: the refund category (`isDoctor` from the API) shows the doctor picker and the doctor's `refundable` credit, any other category asks for a payee. The refund limit in the form is guidance only; the API refuses above the credit (`409 error.outgoing.refund_exceeds_credit`) and its message is shown in the form alert.
- The two directions share the void dialog, the cheque-status dialog and `PaymentStatusBadge` (`direction="out"` picks `/outgoing-payments/{id}/void` and `/outgoing-cheques/{id}/status`). The register is `GET /cheques/register` (+ `/summary`): rows carry `direction`, `party`, `category`; the summary's status counts cover both directions, so they are hidden under a direction chip.
- Controls are hidden by permission (`useCan`: `expenses.read/write/void`, `ledger.read`, `cheques.write`); a `null` Home figure (no `expenses.read`) means "leave the figure out", never zero.

**Delivery and the bell (B5)**
- `features/cases/DeliveryDialog.tsx`: the only way to deliver. The status dialog's «تم التسليم» hands over to it (`onDeliver`); the case page has a «تسليم الحالة» ActionButton and the row menu an item, both from `allowedStatuses`. The amount due (`deliveryDue`), pending cheques and `collectDue` come from the API; a full payment sends no amount. One Idempotency-Key per attempt when money is taken; after success `storeCase` and, with a payment, `refreshMoney`. `CollectOnDialog` changes or removes the collect date.
- `features/notifications/`: `notificationCountQuery` polls every 60 s (paused while hidden); the feed's texts come from the API in the request language, so its key includes the language. Opening the bell sends `PATCH /notifications/state {all: true, seen: true}`; «إخفاء» sends one key with `dismissed: true`. `storeCase` and `refreshMoney` invalidate `['notifications']`.

**Invoices (B6)**
- `features/invoices/`: `api.ts` (`invoiceKeys`, `refreshInvoices` = invoices + `refreshMoney`), `NewInvoicePage` (type choice, eligible cases, live server preview via `POST /invoices/preview`, one Idempotency-Key per attempt, `expectedTotal` = the preview's total, a click before the preview settles waits for it), `InvoicePage` (print / save PDF / reprint language / void; `?print=1` prints once), `InvoicesPage`, `InvoiceAppearancePage`.
- **One renderer** `document/InvoiceDocument.tsx` for the preview, the appearance and printing. It renders the frozen snapshot only; `safeStyle` lets nothing but hex colours, a size code and whole millimetres reach CSS; all user text is React text; the only image is the lab's frozen logo (`useInvoiceLogoUrl`, blob URL). The renderer never imports `PRODUCT_NAME` or the product logo (ESLint `no-restricted-imports` on `document/**` + a test).
- Printing: `document/invoice-document.css` (A4 sheet on screen, `@media print`), `@page` from `pageRule()`; the shell has `print:hidden` on the sidebar and top bar. `window.print()` after `document.fonts.ready` when available.
