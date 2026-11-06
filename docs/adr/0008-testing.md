# ADR-0008 — Testing toolchain
Status: Accepted · 2026-11-06

## Decision
Jest (NestJS default, mature decorator support) with `@swc/jest` for speed; Supertest for HTTP; Testcontainers (PostgreSQL 16) for integration and e2e so tests use the real database engine. Docker is needed on developer and CI machines only.

> Amended by ADR-0015: `ts-jest` is used instead of `@swc/jest`.

## Consequences
Real constraint and locking behaviour is tested; no SQLite or in-memory fakes for money logic.
