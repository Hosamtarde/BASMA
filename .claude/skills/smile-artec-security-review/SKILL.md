---
name: smile-artec-security-review
description: Use before closing any milestone and whenever adding or changing endpoints that touch authentication, authorization, money, uploads, backups or personal data in Smile Artec.
---
# Security review checklist (OWASP-aligned)

Per endpoint: authenticated? authorized on the server (permission check, not UI)? DTO validated + unknown fields rejected (mass assignment)? ownership/IDOR check? rate-limited where abusable (login, setup)? idempotent where duplicates hurt? audited if sensitive? error leaks nothing (no stack, SQL, paths)?

Global: Argon2id (or tuned bcrypt) hashing; short-lived tokens + rotation/revocation; secure headers; strict CORS; parameterised queries only; no secrets in code/logs/git (env + validated config); logs never contain passwords, tokens or patient data; uploads (if any): type/size validation, no execution, private storage; backups encrypted and access-controlled; dependency audit in CI.

Finance: server computes all totals/prices/balances; voiding requires permission + reason; every money mutation audited with user id; no silent overwrite of history.

Web (apps/web):
- Tokens: access token in memory only (never localStorage/sessionStorage/readable cookies); refresh token only in the httpOnly SameSite=Strict cookie on `/api/v1/auth`; refresh/logout reject cross-origin requests (Origin / Sec-Fetch-Site); a refused refresh ends the session; logout clears server session, cookie and query cache.
- CSP served by the API (ADR-0017): `default-src 'self'`, `script-src 'self'` (no inline scripts in index.html), images `'self' blob:`, `object-src 'none'`, `frame-ancestors 'none'`; no `data:` assets (Vite `assetsInlineLimit: 0`). Any loosening needs a reason in the ADR.
- No `dangerouslySetInnerHTML` (lint), no `eval`/`new Function`, no HTML in catalogs; React escapes all text.
- Blob/object URLs (logo, later attachments) are revoked when replaced or unmounted; uploads checked client-side for type and size, and again on the server.
- Redirect targets after login are same-app paths only (`/…`, never `//` or absolute URLs).
- The UI hides what a user may not do, but every check stays on the server; never send client-computed prices, totals, balances or ownership as truth.
- Errors shown to users are the server's localized message plus the correlation id — never stack traces or raw responses.
- `npm audit --audit-level=high` covers the web packages; runtime dependencies should stay at 0 findings.

Output a short report: findings (severity), what was verified by test vs by reading, what remains. Do not claim "fully secure".
