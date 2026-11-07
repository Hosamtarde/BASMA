import type { Settings } from '@/features/shell/settings';

/** A settings answer like the API's, with overrides per test. */
export function settingsFixture(overrides: Partial<Settings> = {}): Settings {
  return {
    logo: { present: false, mimeType: null, sizeBytes: null, sha256: null, updatedAt: null },
    labProfile: {
      nameAr: 'مختبر الاختبار',
      nameEn: 'Test Lab',
      phone: '02 222 3333',
      address: null,
      slogan: null,
      timeZone: 'Asia/Hebron',
      rowVersion: 3,
    },
    currency: {
      code: 'ILS',
      symbol: '₪',
      decimals: 2,
      rowVersion: 1,
      locked: { code: false, decimals: false },
    },
    language: { ui: 'ar', documents: 'ar', rowVersion: 1 },
    numbering: {
      caseNo: { startValue: 1, nextValue: 1, locked: false },
      invoiceNo: { startValue: 1, nextValue: 1, locked: false },
    },
    ...overrides,
  };
}
