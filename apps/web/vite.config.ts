import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    // Same origin as the installed app (ADR-0017): /api goes to the local API.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4310' },
    // The Cairo font is imported from <repo>/assets/fonts (one copy in the repo).
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The API's CSP allows no data: images or fonts; every asset is a real file.
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'eslint-rules/**/*.test.ts'],
    css: false,
    // The heavy screens (new case with the tooth chart, settings) render for real: alone they take
    // up to ~4.5 s, and with every file in parallel they passed 5 s (the default) on the dev machine
    // (B5 item 12). 15 s keeps a hung test visible while leaving room for honest work.
    testTimeout: 15_000,
  },
});
