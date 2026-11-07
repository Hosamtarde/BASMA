import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isValidTimeZone } from '../shared/time/time-zone';

const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_SECRET_CHARS = 16;
const PLACEHOLDER_WORDS = ['change', 'example', 'secret', 'password', 'replace', 'todo', 'xxx'];

const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;

const booleanFromString = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // One computer per installation (owner decision): the API only ever listens on loopback.
  API_HOST: z.enum(LOOPBACK_HOSTS).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  JWT_ACCESS_SECRET: z.string(),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
  MIGRATE_ON_START: booleanFromString.default(true),
  MIGRATIONS_DIR: z.string().min(1).optional(),
  // Built web UI (apps/web/dist) served by this process; unset = API only (development uses Vite).
  WEB_DIST_DIR: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Initial lab time zone for first-run setup; the installer sets it from Windows (B7).
  // Neutral code default; the lab's own value lives in .env / the installer, not in code.
  DEFAULT_TIME_ZONE: z
    .string()
    .refine(isValidTimeZone, { message: 'must be an IANA time zone, e.g. Asia/Hebron' })
    .default('UTC'),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  jwt: { accessSecret: string; accessTtlSeconds: number };
  refreshTokenTtlDays: number;
  /** Requests per minute per client on setup/auth routes. */
  authRateLimitPerMinute: number;
  migrateOnStart: boolean;
  migrationsDir: string;
  logLevel: string;
  /** Absolute folder of the built web UI, or null when the API serves no UI. */
  webDistDir: string | null;
  /** Used by first-run setup when the request names no time zone. */
  defaultTimeZone: string;
  /** Pretty logs and OpenAPI UI are development conveniences only. */
  isProduction: boolean;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

/** Default: <api root>/migrations — same relative depth from src/config and dist/config. */
const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

function secretProblems(secret: string, isProduction: boolean): string[] {
  if (secret.length === 0) return ['JWT_ACCESS_SECRET is required'];
  const problems: string[] = [];
  if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_ACCESS_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (isProduction) {
    const lower = secret.toLowerCase();
    if (PLACEHOLDER_WORDS.some((w) => lower.includes(w))) {
      problems.push('JWT_ACCESS_SECRET looks like a placeholder; generate a random value');
    }
    if (new Set(secret).size < MIN_DISTINCT_SECRET_CHARS) {
      problems.push('JWT_ACCESS_SECRET is too weak (not random enough)');
    }
  }
  return problems;
}

/** Validates the environment once at boot. Fails fast with every problem listed (never prints values). */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const problems = secretProblems(e.JWT_ACCESS_SECRET, isProduction);
  const webDistDir = e.WEB_DIST_DIR === undefined ? null : path.resolve(e.WEB_DIST_DIR);
  if (webDistDir !== null && !existsSync(path.join(webDistDir, 'index.html'))) {
    problems.push('WEB_DIST_DIR must be a folder that contains index.html (build the web app first)');
  }
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    env: e.NODE_ENV,
    host: e.API_HOST,
    port: e.API_PORT,
    databaseUrl: e.DATABASE_URL,
    jwt: { accessSecret: e.JWT_ACCESS_SECRET, accessTtlSeconds: e.JWT_ACCESS_TTL_SECONDS },
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    authRateLimitPerMinute: e.AUTH_RATE_LIMIT_PER_MINUTE,
    migrateOnStart: e.MIGRATE_ON_START,
    migrationsDir: e.MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS_DIR,
    logLevel: e.LOG_LEVEL,
    webDistDir,
    defaultTimeZone: e.DEFAULT_TIME_ZONE,
    isProduction,
  };
}
