# ADR-0015 — Toolchain versions (B0)
Status: Accepted · 2026-11-06

## Context
At B0 the current releases were NestJS 12 (ships as **ESM only**), TypeScript 7 (native compiler) and Node 24 LTS.
NestJS 11 pulls `multer` with a high-severity advisory (GHSA-q7qp-rjg7-q26m); `@nestjs/swagger` and `ts-jest` support TypeScript up to 6.x.

## Decision
- **Node 24 LTS**, **NestJS 12**, **TypeScript 6.0** (`~6.0.3`, pinned until the tooling supports 7).
- The API stays **CommonJS** (`module: nodenext`, no `"type": "module"`). Node 24 loads the ESM-only Nest packages through native `require(esm)` (stable in Node ≥ 22.12), so the compiled `dist/` runs with plain `node` — important for the bundled Windows runtime (ADR-0011).
- Build with `tsc` (no Nest CLI). Dev and scripts run through `ts-node`.
- Tests: **`ts-jest`** instead of `@swc/jest` (ADR-0008): one compiler fewer, and `isolatedModules` keeps it fast. Jest needs `--experimental-vm-modules` to `require` ESM; `scripts/jest.cjs` launches it with that flag. This affects tests only, never production.

## Consequences
- Interfaces used in decorated constructor parameters must be imported with `import type` (TS1272 under `isolatedModules` + `emitDecoratorMetadata`).
- Revisit when Jest supports `require(esm)` without the flag, or when moving the whole API to native ESM.
- Remaining `npm audit` findings at B0 are moderate and in dev-only tools (jest, eslint, drizzle-kit, testcontainers); production dependencies have none. CI fails on `high`.
