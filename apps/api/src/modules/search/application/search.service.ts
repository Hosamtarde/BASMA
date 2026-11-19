import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../../shared/db/database';
import type { Database } from '../../../shared/db/database';
import { foldText } from '../../../shared/text/search-fold';
import { formatVoucher } from '../../payments/domain/payment-rules';
import { Permission } from '../../identity/domain/permissions';
import { toQuery, SearchRepository } from '../infrastructure/search.repository';
import type { CaseHit, DoctorHit, Group, OutgoingHit, PaymentHit } from '../infrastructure/search.repository';

export const SEARCH_DEFAULT_LIMIT = 5;
export const SEARCH_MAX_LIMIT = 10;

export interface SearchResult {
  q: string;
  doctors?: Group<DoctorHit>;
  cases?: Group<CaseHit>;
  payments?: Group<Omit<PaymentHit, 'voucherNo'> & { voucher: string }>;
  /** B4b: outgoing payments (needs expenses.read). */
  outgoing?: Group<Omit<OutgoingHit, 'voucherNo'> & { voucher: string }>;
}

/**
 * Global search (SPEC §5.17): doctors, cases (case number or patient name) and payments (voucher or
 * cheque number). A group the caller may not read is simply absent. Read-only; the text is never
 * logged or audited (it may be a patient name).
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: SearchRepository,
  ) {}

  async search(permissions: readonly string[], text: string, limit: number): Promise<SearchResult> {
    const raw = text.normalize('NFC').replace(/\s+/gu, ' ').trim();
    const q = toQuery(raw, foldText(raw));
    const can = (p: string) => permissions.includes(p);
    const [doctors, cases, payments, outgoing] = await Promise.all([
      can(Permission.DoctorsRead) ? this.repo.doctors(this.db, q, limit) : undefined,
      can(Permission.CasesRead) ? this.repo.cases(this.db, q, limit) : undefined,
      can(Permission.PaymentsRead) ? this.repo.payments(this.db, q, limit) : undefined,
      can(Permission.ExpensesRead) ? this.repo.outgoing(this.db, q, limit) : undefined,
    ]);
    return {
      q: raw,
      ...(doctors ? { doctors } : {}),
      ...(cases ? { cases } : {}),
      ...(payments
        ? {
            payments: {
              ...payments,
              items: payments.items.map(({ voucherNo, ...rest }) => ({ ...rest, voucher: formatVoucher(voucherNo) })),
            },
          }
        : {}),
      ...(outgoing
        ? {
            outgoing: {
              ...outgoing,
              items: outgoing.items.map(({ voucherNo, ...rest }) => ({ ...rest, voucher: formatVoucher(voucherNo, 'out') })),
            },
          }
        : {}),
    };
  }
}
