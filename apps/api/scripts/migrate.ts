/**
 * Applies pending migrations and exits. Used in development and by the installer/upgrader (B7),
 * which takes a backup first and starts the API with MIGRATE_ON_START=false.
 */
import { Pool } from 'pg';
import { loadConfig } from '../src/config/app-config';
import { getMigrationStatus, runMigrations } from '../src/shared/db/migrator';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    await runMigrations(pool, config.migrationsDir);
    const status = await getMigrationStatus(pool, config.migrationsDir);
    console.log(`Migrations applied: ${status.applied}/${status.expected}`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
