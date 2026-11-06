// Jest launcher. NestJS 12 ships as ESM only; Node 24 loads it from our CommonJS code natively
// (require(esm)), but inside Jest this needs `--experimental-vm-modules` (see ADR-0015).
// Usage: node --experimental-vm-modules scripts/jest.cjs [jest args]
require(require.resolve('jest/bin/jest'));
