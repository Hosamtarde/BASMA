---
name: smile-artec-feature-workflow
description: Use when implementing, changing or reviewing any backend feature of Smile Artec. Runs the mandatory 7-step workflow and response format from ENGINEERING_STANDARDS.md and enforces the definition of done.
---
# Feature workflow (Smile Artec)

Follow in order; skip nothing for non-trivial work.

1. **Understand** — inspect existing code, schema, dependencies. Never assume a file or package exists.
2. **Analyze** — architecture fit, security risks, performance, duplication, missing requirements. Check `SPEC.md` for the business rule; if unclear or missing → **ask the owner (Arabic, short, with a recommended default)**. Never invent lab workflows.
3. **Plan** — write the plan (modules touched, DTOs, endpoints, tables/migrations, tests) and get approval before significant changes.
4. **Implement one logical feature** — domain → application service → infrastructure → controller/DTO. Business logic never in controllers; entities never in responses.
5. **Validate** — run lint, typecheck, unit + integration tests, build. Report actual output.
6. **Review** — security (see `smile-artec-security-review`), performance (N+1, indexes, pagination at DB level), correctness, maintainability.
7. **Document** — what changed, why, how to test; update OpenAPI and `docs/`.

**Vertical slices:** when the change has screens, also follow `smile-artec-web-feature-workflow` (contract → generated client → UI → both catalogs → tests in both languages → screenshots).

## Response format (non-trivial requests)
Understanding · Design · DB changes · Security · Performance · Plan · Implementation · Tests & verification · Summary. Keep it concise for small tasks.

## Definition of done
Business logic + validation + authorization + **ar/en catalog entries for every new user-facing string (SPEC §6.1)** + tests (happy, negative, edge, concurrency where relevant) + docs. "Compiles" is not done. Never claim tested/production-ready without saying exactly what was run and what remains.
