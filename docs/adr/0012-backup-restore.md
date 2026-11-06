# ADR-0012 — Backup and restore
Status: Accepted · 2026-11-06

## Decision
Bundled `pg_dump -Fc` runs daily, on service stop and before every upgrade; the last 10 (setting) are kept in an owner-chosen folder; last success/failure is exposed by the API. Restore: `pg_restore` into a temporary DB → validate the `schema_meta` marker and schema version → back up the current DB → swap → restart. Restore is tested in integration tests and on a clean Windows VM (B7). No backup encryption in v1 (owner decision, 2026-11-06); protection is the folder ACL.

## Consequences
Replaces the "backup on app close" wording of SPEC §5.18, because a background service has no close event.
