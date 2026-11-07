/**
 * Demo data (development only): clearly fictional names, phones of the form 059 000 0xxx, and a
 * lab name that says "demo". Amounts are integer minor units for a 2-decimal currency
 * (25000 = 250.00). Deterministic: the same plan every run, so screenshots are comparable.
 */

export const DEMO_LAB = {
  nameAr: 'مختبر الريحان (بيانات تجريبية)',
  nameEn: 'Al-Rayhan Lab (demo data)',
  phone: '059 000 0000',
  slogan: 'Precision · Care · On time',
} as const;

export const DEMO_OWNER_USERNAME = 'owner';

export type Area = 'upper_arch' | 'lower_arch' | 'both_arches';

export interface DemoWorkType {
  name: string;
  /** General price per tooth/unit, minor units. */
  unitPrice: number;
  /** Arch work (dentures, guards) is recorded on an area, not on a tooth. */
  arch?: true;
}

export const WORK_TYPES: readonly DemoWorkType[] = [
  { name: 'زيركون كامل', unitPrice: 25_000 },
  { name: 'بورسلان على معدن', unitPrice: 18_000 },
  { name: 'إي ماكس', unitPrice: 28_000 },
  { name: 'تاج مؤقت', unitPrice: 4_000 },
  { name: 'دعامة زرعة', unitPrice: 35_000 },
  { name: 'طقم كامل', unitPrice: 120_000, arch: true },
  { name: 'طقم جزئي متحرك', unitPrice: 80_000, arch: true },
  { name: 'واقي ليلي', unitPrice: 15_000, arch: true },
];

export const TECHNICIANS: readonly string[] = ['سامر التجريبي', 'رامي الاختبار', 'هبة النموذج'];

export interface DemoDoctor {
  name: string;
  clinic: string;
  phone: string;
  /** Signed minor units: > 0 the doctor owes the lab, < 0 the lab owes the doctor. */
  openingBalance: number;
  /** Special prices by work-type index (minor units). */
  specialPrices?: Readonly<Record<number, number>>;
}

const doctor = (
  n: number,
  name: string,
  clinic: string,
  openingBalance = 0,
  specialPrices?: Record<number, number>,
): DemoDoctor => ({
  name,
  clinic,
  phone: `059 000 0${String(100 + n)}`,
  openingBalance,
  ...(specialPrices ? { specialPrices } : {}),
});

export const DOCTORS: readonly DemoDoctor[] = [
  doctor(1, 'د. أحمد التجريبي', 'عيادة الندى', 150_000, { 0: 22_000, 1: 16_000 }),
  doctor(2, 'د. ريم المثال', 'مركز البسمة', 0),
  doctor(3, 'د. محمد النموذج', 'عيادة الشروق', 42_500, { 2: 26_000 }),
  doctor(4, 'د. ليلى الافتراضية', 'عيادة الياسمين', -20_000),
  doctor(5, 'د. خالد العيّنة', 'مركز الابتسامة', 0),
  doctor(6, 'د. سلمى التجربة', 'عيادة الزيتون', 87_000, { 0: 23_000 }),
  doctor(7, 'د. يوسف الاختبار', 'عيادة القمر', 0),
  doctor(8, 'د. نور الدين المثالي', 'مركز اللؤلؤ', 12_000),
  doctor(9, 'د. هالة النموذجية', 'عيادة النخيل', 0),
  doctor(10, 'د. سامي التجريبي', 'عيادة الريحان', 230_000, { 1: 15_500, 5: 110_000 }),
  doctor(11, 'د. دانا المثال', 'مركز الأمل', 0),
  doctor(12, 'د. عمر العيّنة', 'عيادة السلام', -5_000),
  doctor(13, 'د. رنا الافتراضية', 'عيادة الورد', 0),
  doctor(14, 'د. باسل النموذج', 'مركز الفجر', 64_000),
  doctor(15, 'د. مها التجربة', 'عيادة الربيع', 0),
];

export const PATIENTS: readonly string[] = [
  'كريم داود',
  'سلمى عيسى',
  'دانا الأحمد',
  'ماجد السعدي',
  'ليان حداد',
  'فادي منصور',
  'جنى الخطيب',
  'رامي عودة',
  'تالا يوسف',
  'زياد حمدان',
  'هدى البيطار',
  'وسيم قاسم',
  'نادين سليم',
  'طارق عابد',
  'ميس نصّار',
  'أنس جابر',
  'رهف زيدان',
  'حسن العلي',
  'لمى شاهين',
  'إياد سمارة',
  'شهد الخليل',
  'مراد عطا',
  'بيان صالح',
  'قيس ناصر',
  'روان عمران',
  'سيف الدين حمد',
  'غدير موسى',
  'علاء بركات',
  'ياسمين فارس',
  'معاذ سعيد',
  'آية نجم',
  'باسم حجازي',
  'ريما زهران',
  'عمار شريف',
  'سارة الطويل',
  'جود الشامي',
  'مصطفى كنعان',
  'نور حسّان',
  'هيا عوض',
  'وليد إسماعيل',
];

export type DemoStatus =
  'waiting' | 'design' | 'in_progress' | 'ready' | 'delivered' | 'returned' | 'cancelled';

/** [received days ago, days until expected, final status]. */
export type PlanEntry = readonly [daysAgo: number, leadDays: number, status: DemoStatus];

/**
 * 40 cases over six weeks, every status present. Pre-delivery cases whose expected date has
 * passed (lead < days ago) are the overdue ones on Home.
 */
export const PLAN: readonly PlanEntry[] = [
  [1, 7, 'waiting'],
  [0, 6, 'waiting'],
  [9, 5, 'waiting'],
  [2, 6, 'design'],
  [3, 7, 'design'],
  [1, 8, 'design'],
  [11, 6, 'design'],
  [4, 5, 'design'],
  [5, 6, 'in_progress'],
  [6, 5, 'in_progress'],
  [3, 7, 'in_progress'],
  [8, 10, 'in_progress'],
  [2, 6, 'in_progress'],
  [14, 7, 'in_progress'],
  [4, 4, 'ready'],
  [7, 7, 'ready'],
  [6, 8, 'ready'],
  [5, 3, 'ready'],
  [3, 5, 'ready'],
  [10, 5, 'delivered'],
  [12, 6, 'delivered'],
  [13, 4, 'delivered'],
  [15, 7, 'delivered'],
  [17, 5, 'delivered'],
  [18, 6, 'delivered'],
  [20, 8, 'delivered'],
  [22, 5, 'delivered'],
  [24, 6, 'delivered'],
  [26, 7, 'delivered'],
  [28, 4, 'delivered'],
  [30, 6, 'delivered'],
  [33, 5, 'delivered'],
  [36, 7, 'delivered'],
  [39, 6, 'delivered'],
  [42, 5, 'delivered'],
  [20, 6, 'returned'],
  [16, 5, 'returned'],
  [25, 7, 'cancelled'],
  [12, 6, 'cancelled'],
  [4, 7, 'cancelled'],
];

export const SHADES: readonly string[] = ['A1', 'A2', 'A3', 'A3.5', 'B1', 'B2', 'C2', 'D2', 'BL2'];

export interface DemoLine {
  workType: number;
  toothNo?: number;
  area?: Area;
  shade?: string;
}

/** Small deterministic generator (mulberry32), so the plan never changes between runs. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const BRIDGES: readonly (readonly number[])[] = [
  [14, 15, 16],
  [24, 25, 26],
  [34, 35, 36],
  [44, 45, 46],
  [12, 11, 21],
  [33, 34, 35],
];
const SINGLE_TEETH: readonly number[] = [16, 26, 36, 46, 15, 25, 35, 45, 11, 21, 37, 47];

/** Realistic tooth lines for case `i`: crowns, bridges, anterior e-max, implants, dentures. */
export function linesFor(i: number, rand: () => number): DemoLine[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const shade = pick(SHADES);
  switch (i % 7) {
    case 0:
      return [{ workType: pick([0, 1]), toothNo: pick(SINGLE_TEETH), shade }];
    case 1:
      return pick(BRIDGES).map((toothNo) => ({ workType: 0, toothNo, shade }));
    case 2:
      return [11, 21, 12, 22].slice(0, 2 + Math.floor(rand() * 3)).map((toothNo) => ({
        workType: 2,
        toothNo,
        shade: pick(['B1', 'BL2', 'A1']),
      }));
    case 3:
      return [{ workType: 4, toothNo: pick([36, 46, 26, 16]) }];
    case 4:
      return [
        {
          workType: pick([5, 6]),
          area: pick<Area>(['upper_arch', 'lower_arch', 'both_arches']),
          shade: 'A3',
        },
      ];
    case 5:
      return pick(BRIDGES).map((toothNo) => ({ workType: 1, toothNo, shade }));
    default:
      return rand() < 0.5
        ? [{ workType: 7, area: 'upper_arch' }]
        : [
            { workType: 3, toothNo: 14, shade: 'A2' },
            { workType: 3, toothNo: 15, shade: 'A2' },
          ];
  }
}

/** Every sixth case gets a small discount (minor units, always below any case subtotal). */
export const discountFor = (i: number): number => (i % 6 === 5 ? [1_000, 1_500, 2_000, 2_500][i % 4]! : 0);
