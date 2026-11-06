# ADR-0010 — Concurrency and idempotency
Status: Accepted · 2026-11-06

## Decision
- Optimistic locking: `row_version` on doctors, cases, work types and settings; `UPDATE … WHERE id = $1 AND row_version = $2`; zero rows updated ⇒ `409 error.concurrency.stale`.
- Money writes for a doctor (payment, void, invoice, case total change) lock the doctor row with `SELECT … FOR UPDATE`, so checks such as "partial payment ≤ remaining" are race-free. Isolation: READ COMMITTED plus explicit locks.
- `Idempotency-Key` header (UUID) on payment and invoice creation; unique column + SHA-256 of the canonical request body. Same key + same body ⇒ original response; same key + different body ⇒ `422 error.idempotency.mismatch`.

## Consequences
No duplicate payments from double clicks or retries; tests include parallel requests.
