---
name: smile-artec-security-review
description: Use before closing any milestone and whenever adding or changing endpoints that touch authentication, authorization, money, uploads, backups or personal data in Smile Artec.
---
# Security review checklist (OWASP-aligned)

Per endpoint: authenticated? authorized on the server (permission check, not UI)? DTO validated + unknown fields rejected (mass assignment)? ownership/IDOR check? rate-limited where abusable (login, setup)? idempotent where duplicates hurt? audited if sensitive? error leaks nothing (no stack, SQL, paths)?

Global: Argon2id (or tuned bcrypt) hashing; short-lived tokens + rotation/revocation; secure headers; strict CORS; parameterised queries only; no secrets in code/logs/git (env + validated config); logs never contain passwords, tokens or patient data; uploads (if any): type/size validation, no execution, private storage; backups encrypted and access-controlled; dependency audit in CI.

Finance: server computes all totals/prices/balances; voiding requires permission + reason; every money mutation audited with user id; no silent overwrite of history.

Output a short report: findings (severity), what was verified by test vs by reading, what remains. Do not claim "fully secure".
