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

/** The payments panel of a case (GET /cases/{id}/payments) with nothing bound to it. */
export const emptyCasePayments = (caseId: number, total: number) => ({
  caseId,
  total,
  paid: 0,
  remaining: total,
  payments: [],
});

/** Home figures (GET /ledger/summary) like the API's. */
export const ledgerSummaryFixture = (over: Record<string, number | null> = {}) => ({
  receivedThisMonth: 125000,
  receivedTotal: 300000,
  owedToLab: 450000,
  pendingChequesCount: 2,
  pendingChequesAmount: 70000,
  chequesDueSoon: 1,
  chequesOverdue: 1,
  // B4b: the lab's own money out and its cheques (null for a user without expenses.read).
  outgoingThisMonth: 40000 as number | null,
  outgoingTotal: 90000 as number | null,
  outgoingChequesDueSoon: 1 as number | null,
  outgoingChequesOverdue: 0 as number | null,
  ...over,
});

/** A doctor's balance (GET /doctors/{id}/balance). */
export const balanceFixture = (doctorId: number, balance = 0) => ({
  doctorId,
  openingBalance: 0,
  charges: Math.max(balance, 0),
  received: 0,
  paidOut: 0,
  pendingCheques: 0,
  pendingRefundCheques: 0,
  refundable: Math.max(-balance, 0),
  balance,
  direction: balance > 0 ? 'owed_to_lab' : balance < 0 ? 'owed_by_lab' : 'settled',
});
