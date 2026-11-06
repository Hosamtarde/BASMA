# ADR-0003 — Money as integer minor units
Status: Accepted · 2026-11-06

## Decision
All amounts are `BIGINT` minor units in PostgreSQL (agorot for ₪ with 2 decimals — owner decision). In TypeScript they are `number` guarded by `Number.isSafeInteger` (about ±9×10^15 minor units, far above any lab amount). One `shared/money` module parses input, formats output and rounds **half-up** explicitly. No floats, no `toFixed` outside that module. Decimals (0–3) come from settings and are locked once financial data exists.

## Consequences
Exact sums without `NUMERIC` ↔ string conversions. The API exchanges integers plus a currency block `{code, symbol, decimals}`.
