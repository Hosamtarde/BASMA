import 'reflect-metadata';
import { Pool } from 'pg';
import pino from 'pino';
import { createApp } from './app.factory';
import { ConfigError, loadConfig } from './config/app-config';
import { runMigrations } from './shared/db/migrator';

async function bootstrap(): Promise<void> {
  const bootLog = pino({ name: 'bootstrap' });
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      bootLog.fatal({ problems: err.problems }, 'Invalid configuration; refusing to start');
      process.exit(1);
    }
    throw err;
  }

  // Disabled by the installer, which backs up the database and migrates explicitly first (B7).
  if (config.migrateOnStart) {
    const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
    try {
      await runMigrations(pool, config.migrationsDir);
      bootLog.info('Migrations applied');
    } finally {
      await pool.end();
    }
  }

  const app = await createApp(config);
  await app.listen(config.port, config.host);
  bootLog.info({ host: config.host, port: config.port }, 'API listening');
}

bootstrap().catch((err: unknown) => {
  pino({ name: 'bootstrap' }).fatal({ err }, 'Startup failed');
  process.exit(1);
});
