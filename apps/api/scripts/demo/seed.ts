/**
 * Fills an empty installation with the demo plan through the real HTTP API (development only):
 * every validation, price rule, snapshot, number and audit entry applies exactly as for a user.
 * Refuses when doctors, work types, technicians or cases already exist (never mixes with data).
 * Not part of the production build (scripts/ is outside tsconfig.build.json).
 */
import { randomUUID } from 'node:crypto';
import {
  DEMO_LAB,
  DOCTORS,
  discountFor,
  linesFor,
  PATIENTS,
  PLAN,
  prng,
  TECHNICIANS,
  WORK_TYPES,
} from './data';
import type { DemoStatus } from './data';

export interface SeedOptions {
  /** http://127.0.0.1:<port> of a running API. */
  baseUrl: string;
  username: string;
  password: string;
  log?: (line: string) => void;
  /**
   * Adds the B4 ledger extras (negative opening balance, 30 open cases, a credit left by a cancelled
   * case, Arabic spelling variants). Off by default so the base demo keeps its 15 doctors / 40 cases.
   */
  extras?: boolean;
}

export interface SeedReport {
  payments: number;
  cheques: number;
  workTypes: number;
  specialPrices: number;
  technicians: number;
  doctors: number;
  cases: number;
  byStatus: Record<DemoStatus, number>;
  overdue: number;
  extras?: { doctors: number; cases: number };
}

export class DemoSeedRefused extends Error {}

interface Created {
  id: number;
  rowVersion: number;
  /** Present on case answers. */
  total?: number;
  doctor?: { id: number };
}

interface PaidAnswer {
  payment: { id: number; rowVersion: number; cheque: { id: number; rowVersion: number } | null };
}

class Api {
  private token = '';
  constructor(private readonly baseUrl: string) {}

  async login(username: string, password: string): Promise<void> {
    const res = await this.call<{ accessToken: string }>('POST', '/auth/login', { username, password });
    this.token = res.accessToken;
  }

  async call<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** YYYY-MM-DD in the lab's time zone, shifted by whole days (date-only arithmetic in UTC). */
function labDate(timeZone: string, daysAgo: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - daysAgo)).toISOString().slice(0, 10);
}

const PRE_DELIVERY: readonly DemoStatus[] = ['waiting', 'design', 'in_progress', 'ready'];

/** Status steps after creation, so each case has a realistic history. */
function stepsTo(status: DemoStatus): DemoStatus[] {
  switch (status) {
    case 'in_progress':
      return ['in_progress'];
    case 'ready':
      return ['in_progress', 'ready'];
    case 'delivered':
      return ['in_progress', 'ready', 'delivered'];
    case 'returned':
      return ['in_progress', 'ready', 'delivered', 'returned'];
    default:
      return [];
  }
}

/** Extra doctors that exercise the debts breakdown and the search (B4); see docs/plans/b4-debts-reports-search.md §7. */
async function seedLedgerExtras(
  api: Api,
  ctx: {
    workTypeId: number;
    timeZone: string;
    pay: (body: Record<string, unknown>) => Promise<PaidAnswer>;
    log: (line: string) => void;
  },
): Promise<{ doctors: number; cases: number }> {
  let doctors = 0;
  let cases = 0;
  const newDoctor = async (name: string, openingBalance: number, clinic: string) => {
    doctors += 1;
    return (await api.call<Created>('POST', '/doctors', { name, clinic, openingBalance })).id;
  };
  const newCase = async (doctorId: number, patientName: string, daysAgo: number, unitPrice?: number) => {
    cases += 1;
    return api.call<Created>('POST', '/cases', {
      doctorId,
      patientName,
      receivedDate: labDate(ctx.timeZone, daysAgo),
      expectedDate: labDate(ctx.timeZone, daysAgo - 14),
      status: 'design',
      lines: [{ toothNo: 11, workTypeId: ctx.workTypeId, ...(unitPrice ? { unitPrice } : {}) }],
    });
  };
  const today = labDate(ctx.timeZone, 0);

  // A negative opening balance (the lab owes him) and one partly paid case.
  const negative = await newDoctor('د. إيمان الرصيد السالب', -35_000, 'عيادة الاختبار');
  const c = await newCase(negative, 'مريض تجريبي سالب', 5, 80_000);
  await ctx.pay({ doctorId: negative, caseId: c.id, method: 'cash', amount: 30_000, paidAt: today });

  // Many open cases (breakdown paging, a longer export), one payment that clears only the oldest.
  const many = await newDoctor('د. ماجد كثير الحالات', 0, 'مركز الحالات الكثيرة');
  for (let i = 0; i < 30; i += 1) await newCase(many, `مريض متعدد ${i + 1}`, 60 - i, 20_000 + (i % 5) * 1_000);
  await ctx.pay({ doctorId: many, method: 'cash', amount: 70_000, paidAt: today });

  // A payment bound to a case that was then cancelled stays as account credit («مستحق عليّ»).
  const credit = await newDoctor('د. ندى الملغاة', 0, 'عيادة الرصيد الدائن');
  const cancelled = await newCase(credit, 'مريض ملغى', 3, 50_000);
  await ctx.pay({ doctorId: credit, caseId: cancelled.id, method: 'transfer', amount: 50_000, paidAt: today });
  await api.call('POST', `/cases/${cancelled.id}/cancel`, {
    rowVersion: cancelled.rowVersion,
    reason: 'ألغاها الطبيب (تجريبي).',
  });

  // Spelling variants for the search: hamza and ta marbuta, ya and alef maqsura.
  await newDoctor('د. أحمد الهمزة', 0, 'عيادة الهمزة');
  await newDoctor('د. احمد الهمزة الثانية', 0, 'عيادة بدون همزة');
  await newDoctor('د. فاطمة الخطيب', 0, 'عيادة التاء المربوطة');
  await newDoctor('د. مصطفى الألف المقصورة', 0, 'عيادة الياء');
  ctx.log(`B4 extras: ${doctors} doctors, ${cases} cases`);
  return { doctors, cases };
}

export async function seedDemo(options: SeedOptions): Promise<SeedReport> {
  const log = options.log ?? (() => undefined);
  const api = new Api(options.baseUrl);
  await api.login(options.username, options.password);

  const total = async (path: string) => (await api.call<{ total: number }>('GET', path)).total;
  const existing = {
    doctors: await total('/doctors?page=1'),
    workTypes: await total('/work-types?page=1'),
    technicians: await total('/technicians?page=1'),
    cases: await total('/cases/summary'),
  };
  if (Object.values(existing).some((n) => n > 0)) {
    throw new DemoSeedRefused(
      `Refusing to add demo data: the installation is not empty (${JSON.stringify(existing)}).`,
    );
  }

  const settings = await api.call<{ labProfile: { rowVersion: number; timeZone: string } }>(
    'GET',
    '/settings',
  );
  await api.call('PATCH', '/settings/lab-profile', {
    rowVersion: settings.labProfile.rowVersion,
    ...DEMO_LAB,
  });
  const timeZone = settings.labProfile.timeZone;
  log(`Lab profile: ${DEMO_LAB.nameAr} / ${DEMO_LAB.nameEn}`);

  const workTypeIds: number[] = [];
  for (const [i, w] of WORK_TYPES.entries()) {
    const created = await api.call<Created>('POST', '/work-types', {
      name: w.name,
      unitPrice: w.unitPrice,
      sortOrder: (i + 1) * 10,
    });
    workTypeIds.push(created.id);
  }
  log(`Work types: ${WORK_TYPES.length}`);

  const technicianIds: number[] = [];
  for (const name of TECHNICIANS)
    technicianIds.push((await api.call<Created>('POST', '/technicians', { name })).id);
  log(`Technicians: ${TECHNICIANS.length}`);

  const doctorIds: number[] = [];
  let specialPrices = 0;
  for (const d of DOCTORS) {
    const created = await api.call<Created>('POST', '/doctors', {
      name: d.name,
      clinic: d.clinic,
      phone: d.phone,
      openingBalance: d.openingBalance,
    });
    doctorIds.push(created.id);
    for (const [index, price] of Object.entries(d.specialPrices ?? {})) {
      await api.call('PUT', `/doctors/${created.id}/prices/${workTypeIds[Number(index)]}`, { price });
      specialPrices += 1;
    }
  }
  log(`Doctors: ${DOCTORS.length} (${specialPrices} special prices)`);

  const rand = prng(20261107);
  const byStatus: Record<DemoStatus, number> = {
    waiting: 0,
    design: 0,
    in_progress: 0,
    ready: 0,
    delivered: 0,
    returned: 0,
    cancelled: 0,
  };
  let overdue = 0;
  let payments = 0;
  let cheques = 0;
  let creditShown = false;
  const pay = async (body: Record<string, unknown>) => {
    payments += 1;
    if (body.method === 'cheque') cheques += 1;
    return api.call<PaidAnswer>('POST', '/payments', body, { 'Idempotency-Key': randomUUID() });
  };
  for (const [i, [daysAgo, lead, status]] of PLAN.entries()) {
    const receivedDate = labDate(timeZone, daysAgo);
    const expectedDate = labDate(timeZone, daysAgo - lead);
    const initial: DemoStatus = status === 'waiting' ? 'waiting' : 'design';
    const lines = linesFor(i, rand).map((l) => ({
      workTypeId: workTypeIds[l.workType],
      ...(l.toothNo === undefined ? { area: l.area } : { toothNo: l.toothNo }),
      ...(l.shade ? { shade: l.shade } : {}),
    }));
    const technician = i % 4 === 3 ? null : technicianIds[i % technicianIds.length];
    let current = await api.call<Created>('POST', '/cases', {
      doctorId: doctorIds[(i * 7) % doctorIds.length],
      patientName: PATIENTS[i % PATIENTS.length],
      technicianId: technician,
      receivedDate,
      expectedDate,
      status: initial,
      discount: discountFor(i),
      ...(i % 5 === 2 ? { notes: 'ملاحظة تجريبية: يرجى مطابقة اللون مع الصورة المرفقة من العيادة.' } : {}),
      lines,
    });
    for (const to of stepsTo(status)) {
      // Delivered on the expected date, or today when that is still ahead.
      const deliveredDate = to === 'delivered' ? labDate(timeZone, Math.max(daysAgo - lead, 0)) : undefined;
      current = await api.call<Created>('POST', `/cases/${current.id}/status`, {
        rowVersion: current.rowVersion,
        to,
        ...(deliveredDate ? { deliveredDate } : {}),
        ...(to === 'returned' ? { note: 'تعديل بسيط في الإطباق (تجريبي).' } : {}),
      });
    }
    // Payments (B3), through the real API: bound to the case, in the shapes a lab sees every day.
    const caseTotal = current.total ?? 0;
    const caseDoctor = doctorIds[(i * 7) % doctorIds.length] as number;
    const today = labDate(timeZone, 0);
    if (status === 'delivered' && i % 3 === 0 && caseTotal > 0) {
      await pay({
        doctorId: caseDoctor,
        caseId: current.id,
        method: i % 2 === 0 ? 'cash' : 'transfer',
        amount: caseTotal,
        paidAt: today,
      });
    } else if (status === 'delivered' && i % 3 === 1 && caseTotal > 4) {
      await pay({
        doctorId: caseDoctor,
        caseId: current.id,
        method: 'cash',
        amount: Math.floor(caseTotal * 0.4),
        paidAt: today,
      });
    } else if (PRE_DELIVERY.includes(status) && i % 4 === 0 && caseTotal > 4) {
      // An advance: a payment taken when the work was received.
      await pay({
        doctorId: caseDoctor,
        caseId: current.id,
        method: 'cash',
        amount: Math.floor(caseTotal * 0.3),
        paidAt: labDate(timeZone, Math.min(daysAgo, 3)),
      });
    } else if (status === 'cancelled' && !creditShown && caseTotal > 4) {
      // Kept as account credit when the case is cancelled (SPEC §5.6).
      creditShown = true;
      await pay({
        doctorId: caseDoctor,
        caseId: current.id,
        method: 'cash',
        amount: Math.floor(caseTotal * 0.2),
        paidAt: today,
      });
    }
    if (status === 'cancelled') {
      await api.call('POST', `/cases/${current.id}/cancel`, {
        rowVersion: current.rowVersion,
        reason: 'ألغاها الطبيب (تجريبي).',
      });
    }
    byStatus[status] += 1;
    if ((PRE_DELIVERY.includes(status) || status === 'returned') && lead < daysAgo) overdue += 1;
  }
  log(`Cases: ${PLAN.length} ${JSON.stringify(byStatus)}, overdue about ${overdue}`);

  // Unbound payments (paid FIFO at read time), cheques in every state, one voided payment, one credit.
  const today = labDate(timeZone, 0);
  for (const [d, amount] of [
    [2, 80_000],
    [3, 120_000],
    [4, 50_000],
  ] as const) {
    await pay({ doctorId: doctorIds[d], method: d === 3 ? 'transfer' : 'cash', amount, paidAt: today });
  }
  const chequeDoctor = doctorIds[0] as number;
  let chequeNo = 1000;
  const cheque = (dueInDays: number, bank = 'بنك فلسطين') => ({
    doctorId: chequeDoctor,
    method: 'cheque',
    amount: 50_000,
    paidAt: today,
    cheque: { chequeNo: String((chequeNo += 1)), bank, dueDate: labDate(timeZone, -dueInDays) },
  });
  await pay(cheque(3)); // pending, due soon
  await pay(cheque(-6, 'البنك العربي')); // pending, overdue
  await pay(cheque(40)); // pending, later
  const cleared = await pay(cheque(10));
  const returned = await pay(cheque(-2, 'بنك القدس'));
  const bounced = await pay(cheque(-1));
  const set = async (r: PaidAnswer, to: string) =>
    api.call<PaidAnswer>('PATCH', `/cheques/${r.payment.cheque?.id}/status`, {
      rowVersion: r.payment.cheque?.rowVersion,
      status: to,
      statusDate: today,
    });
  await set(cleared, 'cleared');
  await set(returned, 'returned');
  const bouncedCleared = await set(bounced, 'cleared');
  await set(bouncedCleared, 'returned'); // cleared, then bounced
  const wrong = await pay({ doctorId: doctorIds[1], method: 'cash', amount: 12_300, paidAt: today });
  await api.call('POST', `/payments/${wrong.payment.id}/void`, {
    rowVersion: wrong.payment.rowVersion,
    reason: 'سُجّلت على الطبيب الخطأ (تجريبي).',
  });
  // One doctor pays more than he owes: a credit («مستحق عليّ»).
  await pay({ doctorId: doctorIds[DOCTORS.length - 1], method: 'cash', amount: 1_500_000, paidAt: today });
  log(`Payments: ${payments} (${cheques} cheques)`);

  const extras = options.extras
    ? await seedLedgerExtras(api, { workTypeId: workTypeIds[0] as number, timeZone, pay, log })
    : undefined;

  return {
    payments,
    cheques,
    workTypes: WORK_TYPES.length,
    specialPrices,
    technicians: TECHNICIANS.length,
    doctors: DOCTORS.length,
    cases: PLAN.length,
    byStatus,
    overdue,
    ...(extras ? { extras } : {}),
  };
}
