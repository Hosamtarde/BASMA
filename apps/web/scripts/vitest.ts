/**
 * CLI: runs Vitest from a working directory whose Windows drive letter is upper case (B5 item 13).
 *
 * From a shell that reports the folder as `c:\…` (Git Bash `/c/…`, the agent's Bash tool), Vitest
 * loaded itself under two spellings of the same path and every jsdom suite failed with "Vitest
 * failed to find the current suite"; the same command from `C:\…` passed. Normalising the drive
 * letter before Vitest starts makes `npm test` work from any shell. Other platforms are unchanged.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const upper = (p: string): string =>
  process.platform === 'win32' && /^[a-z]:/.test(p) ? `${p[0]!.toUpperCase()}${p.slice(1)}` : p;
const bin = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const result = spawnSync(process.execPath, [upper(bin), ...process.argv.slice(2)], {
  cwd: upper(process.cwd()),
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
