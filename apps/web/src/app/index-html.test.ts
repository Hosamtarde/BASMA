import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(import.meta.dirname, '../../index.html'), 'utf8');

describe('index.html', () => {
  it('starts in Arabic, right to left, before any script runs (SPEC §6.1)', () => {
    expect(html).toMatch(/<html lang="ar" dir="rtl">/);
  });

  it('has no inline script (the CSP allows script-src self only)', () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.every((tag) => / src="/.test(tag))).toBe(true);
  });
});
