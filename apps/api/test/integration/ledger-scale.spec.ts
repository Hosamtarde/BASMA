import request from 'supertest';
import { startTestApp, TestApp } from '../support/app';
import { loadDataset, TARGET_SIZE } from '../support/large-dataset';

jest.setTimeout(600_000);

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
};

describe('stage 0 — baseline timings at the SPEC scale (20 000 cases / 50 000 payments)', () => {
  let t: TestApp;
  let doctorIds: number[];

  beforeAll(async () => {
    t = await startTestApp();
    const t0 = Date.now();
    doctorIds = await loadDataset(t.pool, TARGET_SIZE);
    // eslint-disable-next-line no-console
    console.log(`dataset loaded in ${Date.now() - t0} ms`);
  });
  afterAll(async () => {
    await t?.close();
  });

  async function time(label: string, runs: number, fn: (i: number) => Promise<unknown>): Promise<void> {
    const ms: number[] = [];
    for (let i = 0; i < runs; i++) {
      const s = process.hrtime.bigint();
      await fn(i);
      ms.push(Number(process.hrtime.bigint() - s) / 1e6);
    }
    // eslint-disable-next-line no-console
    console.log(`BASELINE ${label}: p50 ${pct(ms, 50).toFixed(1)} ms, p95 ${pct(ms, 95).toFixed(1)} ms (${runs} runs)`);
  }

  it('records timings of today\'s endpoints and of the search patterns', async () => {
    const get = (url: string) => request(t.http).get(url).set('Authorization', t.auth).expect(200);
    await time('GET /cases?pageSize=25', 20, (i) => get(`/api/v1/cases?pageSize=25&page=${1 + (i % 50)}`));
    await time('GET /doctors?pageSize=25', 20, () => get('/api/v1/doctors?pageSize=25'));
    await time('GET /debts', 20, () => get('/api/v1/debts?pageSize=25'));
    await time('GET /doctors/{heavy}/balance', 20, () => get(`/api/v1/doctors/${doctorIds[0]}/balance`));
    await time('GET /doctors/{normal}/balance', 20, (i) => get(`/api/v1/doctors/${doctorIds[10 + i]}/balance`));
    await time('GET /payments?pageSize=25', 20, () => get('/api/v1/payments?pageSize=25'));
    await time('ILIKE cases.patient_name contains', 30, (i) =>
      t.pool.query(`SELECT id FROM cases WHERE patient_name ILIKE $1 LIMIT 5`, [`%${i % 2 ? 'atient 1' : 'zz'}%`]),
    );
    await time('ILIKE doctors.name contains', 30, () =>
      t.pool.query(`SELECT id FROM doctors WHERE name ILIKE $1 OR clinic ILIKE $1 OR phone ILIKE $1 LIMIT 5`, ['%dr 1%']),
    );
  });
});
