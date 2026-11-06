# ADR-0006 — Structured logging
Status: Accepted · 2026-11-06

## Decision
`nestjs-pino` JSON logs. Correlation id taken from `X-Request-Id` or generated, returned in responses and error envelopes. Redaction of `authorization`, cookies, `password*`, `token*`; patient names are never logged. Production writes rotated files under the data folder; development uses pretty output.

## Consequences
Diagnosable support bundles later without leaking personal data.
