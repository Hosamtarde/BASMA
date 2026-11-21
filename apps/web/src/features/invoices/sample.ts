import { groupInvoiceLines, invoiceTotals, layoutOf } from '@app/shared';
import type { CasesInvoiceSnapshot, DocumentLanguage, InvoiceTemplate } from '@app/shared';
import type { components } from '@/api/schema.gen';

type Settings = components['schemas']['SettingsResponse'];

/**
 * Sample data for the «مظهر الفاتورة» preview (SPEC §5.15: «عيادة تجريبية», «تاج زيركون», «جسر خزف»). The lab
 * identity is the real one from Settings; the names come from the catalog of the preview language. Built with
 * the same shared functions the API uses, so the preview passes the same totals check.
 */
export function sampleSnapshot(
  settings: Settings | undefined,
  template: InvoiceTemplate,
  language: DocumentLanguage,
  names: { clinic: string; doctor: string; zirconia: string; bridge: string; patient1: string; patient2: string; notes: string },
  today: string,
): CasesInvoiceSnapshot {
  const lines = groupInvoiceLines([
    ...[11, 21].map((toothNo) => ({ caseNo: 1024, patientName: names.patient1, workTypeName: names.zirconia, shade: 'A2', unitPrice: 15000, toothNo, area: null })),
    ...[35, 36, 37].map((toothNo) => ({ caseNo: 1031, patientName: names.patient2, workTypeName: names.bridge, shade: 'B1', unitPrice: 12000, toothNo, area: null })),
  ]);
  const totals = invoiceTotals(lines, 5000);
  const p = settings?.labProfile;
  return {
    version: 1,
    type: 'cases',
    no: 1001,
    issueDate: today,
    language,
    lab: {
      nameAr: p?.nameAr ?? null,
      nameEn: p?.nameEn ?? null,
      phone: p?.phone ?? null,
      address: p?.address ?? null,
      slogan: p?.slogan ?? null,
      logo: settings?.logo.present ? { sha256: settings.logo.sha256 ?? '', mimeType: settings.logo.mimeType ?? 'image/png' } : null,
    },
    currency: {
      code: settings?.currency?.code ?? 'ILS',
      symbol: settings?.currency?.symbol ?? '₪',
      decimals: settings?.currency?.decimals ?? 2,
    },
    party: { kind: 'doctor', doctorId: 0, name: names.doctor, clinic: names.clinic, phone: '0599 000 000' },
    layout: layoutOf(template),
    notes: names.notes,
    cases: [
      { caseNo: 1024, patientName: names.patient1, receivedDate: today, deliveredDate: today, status: 'delivered', subtotal: 30000, discount: 0, total: 30000, paid: 0, remaining: 30000 },
      { caseNo: 1031, patientName: names.patient2, receivedDate: today, deliveredDate: today, status: 'delivered', subtotal: 36000, discount: 5000, total: 31000, paid: 0, remaining: 31000 },
    ],
    lines,
    totals,
    balances: { previous: 20000, current: 20000 + totals.total, pendingCheques: 0 },
  };
}
