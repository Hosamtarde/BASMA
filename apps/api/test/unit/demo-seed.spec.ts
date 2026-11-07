import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isFdiTooth } from '../../src/modules/cases/domain/case-rules';
import { discountFor, DOCTORS, linesFor, PATIENTS, PLAN, prng, WORK_TYPES } from '../../scripts/demo/data';
import { assertDemoDatabase, DemoGuardError } from '../../scripts/demo/guard';

describe('demo seed guard', () => {
  it.each([
    'postgres://u:p@127.0.0.1:5432/lab_demo',
    'postgres://u:p@localhost:54329/lab_app_e2e',
    'postgresql://u:p@[::1]:5432/smile_e2e',
  ])('allows a local throw-away database: %s', (url) => {
    expect(() => assertDemoDatabase(url)).not.toThrow();
  });

  it('returns the database name', () => {
    expect(assertDemoDatabase('postgres://u:p@127.0.0.1/lab_demo')).toBe('lab_demo');
  });

  it.each([
    ['a real lab database', 'postgres://u:p@127.0.0.1:5432/lab_dev'],
    ['a production-looking name', 'postgres://u:p@127.0.0.1:5432/dental_lab'],
    ['a suffix in the middle', 'postgres://u:p@127.0.0.1:5432/lab_demo_real'],
    ['a look-alike suffix', 'postgres://u:p@127.0.0.1:5432/labdemo'],
    ['no database name', 'postgres://u:p@127.0.0.1:5432/'],
    ['a remote server', 'postgres://u:p@db.example.com:5432/lab_demo'],
    ['another protocol', 'mysql://u:p@127.0.0.1/lab_demo'],
    ['not a URL', 'lab_demo'],
    ['nothing at all', undefined],
  ])('refuses %s', (_label, url) => {
    expect(() => assertDemoDatabase(url)).toThrow(DemoGuardError);
  });

  it('is not part of the production build', () => {
    const build = JSON.parse(readFileSync(path.join(__dirname, '../../tsconfig.build.json'), 'utf8')) as {
      include: string[];
    };
    expect(build.include).toEqual(['src']);
  });
});

describe('demo data plan', () => {
  it('has about 15 doctors, 8 work types and 40 cases covering every status and some overdue', () => {
    expect(DOCTORS).toHaveLength(15);
    expect(WORK_TYPES).toHaveLength(8);
    expect(PLAN).toHaveLength(40);
    expect(new Set(PLAN.map(([, , s]) => s))).toEqual(
      new Set(['waiting', 'design', 'in_progress', 'ready', 'delivered', 'returned', 'cancelled']),
    );
    const overdue = PLAN.filter(
      ([daysAgo, lead, s]) => ['waiting', 'design', 'in_progress', 'ready'].includes(s) && lead < daysAgo,
    );
    expect(overdue.length).toBeGreaterThanOrEqual(4);
    expect(PATIENTS.length).toBeGreaterThanOrEqual(PLAN.length);
    expect(DOCTORS.some((d) => d.openingBalance !== 0 && d.specialPrices)).toBe(true);
  });

  it('builds valid lines: FDI teeth for tooth work, an arch for arch work, integer prices', () => {
    const rand = prng(1);
    for (let i = 0; i < 200; i += 1) {
      for (const l of linesFor(i, rand)) {
        const type = WORK_TYPES[l.workType];
        expect(type).toBeDefined();
        if (type?.arch) {
          expect(l.toothNo).toBeUndefined();
          expect(l.area).toBeDefined();
        } else {
          expect(isFdiTooth(l.toothNo ?? 0)).toBe(true);
        }
      }
    }
    for (const w of WORK_TYPES) expect(Number.isInteger(w.unitPrice)).toBe(true);
  });

  it('keeps every discount an integer below the cheapest possible case', () => {
    const cheapest = Math.min(...WORK_TYPES.map((w) => w.unitPrice));
    for (let i = 0; i < PLAN.length; i += 1) {
      expect(Number.isInteger(discountFor(i))).toBe(true);
      expect(discountFor(i)).toBeLessThan(cheapest);
    }
  });

  it('is deterministic', () => {
    const a = prng(7);
    const b = prng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
