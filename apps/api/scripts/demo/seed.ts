/**
 * Fills an empty installation with the demo plan through the real HTTP API (development only):
 * every validation, price rule, snapshot, number and audit entry applies exactly as for a user.
 * Refuses when doctors, work types, technicians or cases already exist (never mixes with data).
 * Not part of the production build (scripts/ is outside tsconfig.build.json).
 */
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
}

export interface SeedReport {
  workTypes: number;
  specialPrices: number;
  technicians: number;
  doctors: number;
  cases: number;
  byStatus: Record<DemoStatus, number>;
  overdue: number;
}

export class DemoSeedRefused extends Error {}

interface Created {
  id: number;
  rowVersion: number;
}

class Api {
  private token = '';
  constructor(private readonly baseUrl: string) {}

  async login(username: string, password: string): Promise<void> {
    const res = await this.call<{ accessToken: string }>('POST', '/auth/login', { username, password });
    this.token = res.accessToken;
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
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

  return {
    workTypes: WORK_TYPES.length,
    specialPrices,
    technicians: TECHNICIANS.length,
    doctors: DOCTORS.length,
    cases: PLAN.length,
    byStatus,
    overdue,
  };
}
