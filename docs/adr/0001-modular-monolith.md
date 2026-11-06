# ADR-0001 — Modular monolith with layered modules
Status: Accepted · 2026-11-06

## Context
One lab per install, one computer, low traffic, strong consistency needs on money. SPEC §2 asks for a modular monolith.

## Decision
One NestJS app (`apps/api`), one PostgreSQL database. Each business module has `domain` (pure rules), `application` (use cases, transactions), `infrastructure` (DB), `presentation` (controllers/DTOs). Cross-module calls go through application services or small ports; no cyclic imports. Cross-cutting code lives in `src/shared`.

## Consequences
Simple to build, test, package and back up. Module boundaries keep a later split possible, but none is planned.
