# ADR-0009 — Gap-free numbering
Status: Accepted · 2026-11-06

## Decision
Table `counters(name, next_value)`. Inside the insert transaction: `UPDATE counters SET next_value = next_value + 1 WHERE name = $1 RETURNING next_value - 1`. The row lock serialises concurrent inserts and a rollback gives the number back, so there are no gaps. PostgreSQL sequences are not used (they leave gaps).

Owner decision (2026-11-06): the starting number of `case_no` and `invoice_no` is chosen by the owner. It can be changed only while no case / invoice exists. Payments use `IN-000001` / `OUT-000001`.

## Consequences
Inserts of the same kind are serialised — fine for a single lab.
