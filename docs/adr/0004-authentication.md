# ADR-0004 — Authentication and authorization
Status: Accepted · 2026-11-06

## Decision
- Passwords: Argon2id via `@node-rs/argon2` (prebuilt Windows/Linux binaries, no node-gyp), OWASP baseline parameters (m=19 MiB, t=2, p=1), re-tuned on the target PC.
- Access token: JWT (HS256, secret generated per install), 15 minutes, carries user id + permissions.
- Refresh token: 256-bit random, stored only as a SHA-256 hash, rotated on every use; reuse of an old token revokes the whole token family. It travels only as an httpOnly, SameSite=Strict cookie `refresh_token` scoped to `/api/v1/auth` (never in a JSON body); `Secure` is added when served over HTTPS. Refresh and logout also reject requests whose `Origin`/`Sec-Fetch-Site` is not same-origin (every port on 127.0.0.1 is the same *site*). The access token stays in the UI memory only (F0).
- Authorization: global guard; every route declares a permission (e.g. `payments.void`); role `owner` holds all. Routes without a declared permission are denied by default (explicit `@Public()` for setup/login/health).
- First-run setup works only while no user exists.

## Consequences
Adding roles later is data, not redesign. No user-management endpoints in v1 (SPEC §3.3).
