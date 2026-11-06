# ADR-0013 — Licensing seam (not built)
Status: Accepted · 2026-11-06

## Decision
Define a `LicenseService` interface (`getStatus()`) with one always-valid implementation; no checks wired into features in v1. Activation, subscriptions and update channels are decided with the owner later (see `docs/production-readiness.md`).
