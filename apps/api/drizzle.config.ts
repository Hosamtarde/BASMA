import { defineConfig } from 'drizzle-kit';

// Only used to GENERATE migration SQL from the schema (no DB connection needed).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/db/schema/index.ts',
  out: './migrations',
});
