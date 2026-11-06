---
name: smile-artec-db-migrations
description: Use when creating or changing database tables, constraints, indexes or migrations in Smile Artec.
---
# Database & migrations

- Forward-only, numbered/timestamped migrations; every migration tested on an empty DB **and** on the previous schema with data.
- Explicit nullability, PK/FK, unique + CHECK constraints, correct types (no float for money), consistent snake_case naming, explicit ON DELETE/UPDATE behaviour (financial history: RESTRICT, never cascade-delete money).
- Indexes only for real query patterns (list them next to the query in the PR); look at the execution plan for anything slow; no N+1; filter/sort/paginate in SQL; select only needed columns.
- Mutable aggregates: `row_version`. Audit columns: `created_at/by`, `updated_at/by`. Payments/invoices: unique `idempotency_key`.
- Multi-record operations (payment + cheque + audit, invoice + invoice_cases + case flags) run in **one transaction**; consider isolation/locking for per-doctor balances.
- Destructive changes (drop/rename) need an expand→migrate→contract plan and a backup note.
- Migrations must run unattended inside the Windows installer/upgrader (after an automatic `pg_dump` backup, with rollback on failure).
- Seed data (work types with price 0, expense categories) lives in a separate, idempotent seed — not in schema migrations.
