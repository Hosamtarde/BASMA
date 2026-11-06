import { ConfigError, loadConfig } from './app-config';

const STRONG_SECRET = 'q7Z-pL2vX9rT4mK8wB1nC6yH3jF5dG0s_aE';
const base = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
  JWT_ACCESS_SECRET: STRONG_SECRET,
};

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies safe defaults (localhost only, migrations on, 15-min tokens)', () => {
    const c = loadConfig(base);
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(4310);
    expect(c.migrateOnStart).toBe(true);
    expect(c.jwt.accessTtlSeconds).toBe(900);
    expect(c.authRateLimitPerMinute).toBe(10);
    expect(c.isProduction).toBe(false);
  });

  it('validates DEFAULT_TIME_ZONE (neutral UTC default in code)', () => {
    expect(loadConfig(base).defaultTimeZone).toBe('UTC');
    expect(loadConfig({ ...base, DEFAULT_TIME_ZONE: 'Asia/Hebron' }).defaultTimeZone).toBe('Asia/Hebron');
    expect(problemsOf({ ...base, DEFAULT_TIME_ZONE: 'Gaza' })[0]).toMatch(/DEFAULT_TIME_ZONE/);
  });

  it('can disable migrations on start (installer runs them after a backup)', () => {
    expect(loadConfig({ ...base, MIGRATE_ON_START: 'false' }).migrateOnStart).toBe(false);
  });

  it('rejects a non-boolean MIGRATE_ON_START', () => {
    expect(problemsOf({ ...base, MIGRATE_ON_START: 'yes' })[0]).toMatch(/MIGRATE_ON_START/);
  });

  it('requires DATABASE_URL and JWT_ACCESS_SECRET, with no defaults', () => {
    const problems = problemsOf({});
    expect(problems.join('\n')).toMatch(/DATABASE_URL/);
    expect(problems.join('\n')).toMatch(/JWT_ACCESS_SECRET/);
  });

  it('rejects an empty or short secret in every environment', () => {
    expect(problemsOf({ ...base, JWT_ACCESS_SECRET: '' })).toEqual(['JWT_ACCESS_SECRET is required']);
    expect(problemsOf({ ...base, JWT_ACCESS_SECRET: 'short' })[0]).toMatch(/at least 32/);
  });

  it('in production rejects placeholder-like and low-entropy secrets', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(problemsOf({ ...prod, JWT_ACCESS_SECRET: 'change-me-change-me-change-me-12345' })[0]).toMatch(
      /placeholder/,
    );
    expect(problemsOf({ ...prod, JWT_ACCESS_SECRET: 'a'.repeat(40) })[0]).toMatch(/too weak/);
    expect(problemsOf({ ...prod })).toEqual([]);
  });

  it('never includes secret values in error messages', () => {
    const secret = 'super-weak-but-unique-value';
    const err = (() => {
      try {
        loadConfig({ ...base, JWT_ACCESS_SECRET: secret });
      } catch (e) {
        return e as Error;
      }
      return undefined;
    })();
    expect(err?.message).not.toContain(secret);
  });
});
