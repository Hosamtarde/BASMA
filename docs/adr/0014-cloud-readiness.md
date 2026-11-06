# ADR-0014 — Future cloud / multi-tenant variant
Status: Accepted · 2026-11-06

## Decision
v1 is single-tenant per install; no `tenant_id` columns. Domain and application code stay free of Windows specifics; all environment details are config.

## What would change for multi-tenant
`tenant_id` on every business table with composite unique keys, row-level security, per-tenant counters and settings, tenant-aware auth claims, central backups. That is a dedicated milestone, started only on an owner decision.
