# ADR-0005 — Validation and OpenAPI
Status: Accepted · 2026-11-06

## Decision
Request DTOs use `class-validator` + `class-transformer` with a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`; `@nestjs/swagger` produces OpenAPI from the same DTOs. Validation errors map to catalog codes. Environment config is validated at boot with `zod` (fail fast, clear list of problems).

## Consequences
One source for validation and docs; unknown fields are rejected (mass assignment). zod is used only for config.
