# ADR-0002 — Drizzle ORM + drizzle-kit SQL migrations
Status: Accepted · 2026-11-06

## Context
Options: Prisma, Drizzle, Knex. Migrations must run unattended inside the Windows installer; we need CHECK constraints, expression/partial indexes, `SELECT … FOR UPDATE` and typed queries.

## Decision
Drizzle ORM (`drizzle-orm` + `pg` driver) for typed queries; `drizzle-kit` generates SQL migrations that are reviewed, hand-edited when needed (CHECKs, expression indexes) and committed. A small migrator runs pending migrations at startup / from the installer, in a transaction, guarded by a PostgreSQL advisory lock.

## Why not Prisma / Knex
Prisma ships a native engine and its own migration runtime: more to bundle on Windows, weaker schema support for CHECK and partial indexes. Knex has no typed query layer.

## Consequences
Pure TypeScript runtime; SQL is visible and reviewable. Forward-only migrations; destructive changes use expand → migrate → contract.
