import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  CasesInvoiceSnapshot,
  DocumentLanguage,
  FreeInvoiceSnapshot,
  groupInvoiceLines,
  INVOICE_SNAPSHOT_VERSION,
  InvoiceLab,
  InvoiceParty,
  InvoiceSnapshot,
  invoiceTotals,
  InvoiceType,
  layoutOf,
  MAX_CASES_PER_INVOICE,
  MAX_STATEMENT_LINES,
  StatementInvoiceSnapshot,
  sumMinor,
  verifySnapshotTotals,
} from '@app/shared';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { assertCurrent } from '../../../shared/db/aggregate';
import { lockCurrencyForMoneyWrite } from '../../../shared/db/currency-guard';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { isUniqueViolation } from '../../../shared/db/pg-errors';
import { notFound } from '../../../shared/errors/common-errors';
import { DomainError } from '../../../shared/errors/domain-error';
import { offsetOf } from '../../../shared/http/pagination';
import { LedgerService } from '../../payments/application/ledger.service';
import { formatVoucher, requestHash } from '../../payments/domain/payment-rules';
import { LedgerRepository } from '../../payments/infrastructure/ledger.repository';
import { PaymentsRepository } from '../../payments/infrastructure/payments.repository';
import { LabCalendar } from '../../settings/application/lab-calendar.service';
import {
  CURRENCY,
  CurrencySetting,
  LAB_PROFILE,
  LabProfile,
  LANGUAGE,
  LanguageSetting,
} from '../../settings/domain/settings-rules';
import { LogoRepository } from '../../settings/infrastructure/logo.repository';
import { SettingsRepository } from '../../settings/infrastructure/settings.repository';
import { fieldProblem, isInvoiceable, sha256Hex, snapshotSha256 } from '../domain/invoice-rules';
import { InvoiceFilter, InvoiceRow, InvoicesRepository, InvoiceWithSnapshot } from '../infrastructure/invoices.repository';
import { InvoiceTemplateService } from './invoice-template.service';

const err = (code: string, status: HttpStatus, params: Record<string, string | number> = {}) =>
  new DomainError(code, status, params);

export interface CreateInvoiceInput {
  type: InvoiceType;
  doctorId?: number;
  caseIds?: number[];
  expectedTotal?: number;
  notes?: string | null;
  from?: string;
  to?: string;
  partyName?: string;
  reason?: string;
  amount?: number;
  language?: DocumentLanguage;
}

export interface InvoiceDetail extends InvoiceRow {
  snapshot: InvoiceSnapshot;
}

export interface InvoiceResult {
  invoice: InvoiceDetail;
  replayed: boolean;
}

interface Built {
  snapshot: InvoiceSnapshot;
  doctorId: number | null;
  partyName: string;
  caseIds: number[];
  logo: { sha256: string; mimeType: string; content: Buffer } | null;
  currencyCode: string;
}

/**
 * Invoices, statements and free invoices (SPEC §5.14, B6 plan). Issuing builds and freezes a snapshot of
 * everything printed; nothing here reads or writes a balance — invoices are ledger-neutral (plan §3). Lock
 * order (ADR-0010): currency SHARE → doctor FOR NO KEY UPDATE → case rows FOR UPDATE (id order) → the
 * `invoice_no` counter. The database refuses any later change to issued content (triggers, plan §2.4).
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: InvoicesRepository,
    private readonly payments: PaymentsRepository,
    private readonly ledger: LedgerService,
    private readonly ledgerRepo: LedgerRepository,
    private readonly settings: SettingsRepository,
    private readonly logos: LogoRepository,
    private readonly calendar: LabCalendar,
    private readonly templates: InvoiceTemplateService,
    private readonly audit: AuditWriter,
  ) {}

  // ------------------------------------------------------------ create / preview

  /** The request as sent (omitted fields stay omitted), so a replay after midnight still matches. */
  private canonical(input: CreateInvoiceInput): Record<string, unknown> {
    return { ...input, caseIds: input.caseIds ? [...input.caseIds] : undefined };
  }

  private checkFields(input: CreateInvoiceInput): void {
    const p = fieldProblem(input.type, input as unknown as Record<string, unknown>);
    if (p) {
      throw err(p.rule === 'required' ? 'error.invoice.field_required' : 'error.invoice.field_not_allowed', HttpStatus.BAD_REQUEST, {
        field: p.field,
      });
    }
    if (input.type === 'free' && (input.doctorId === undefined) === (input.partyName === undefined)) {
      throw err('error.invoice.party_required', HttpStatus.BAD_REQUEST);
    }
    if (input.type === 'cases') {
      const ids = input.caseIds ?? [];
      if (ids.length === 0 || ids.length > MAX_CASES_PER_INVOICE) {
        throw err('error.invoice.case_count', HttpStatus.BAD_REQUEST, { max: MAX_CASES_PER_INVOICE });
      }
      if (new Set(ids).size !== ids.length) throw err('error.invoice.case_duplicate', HttpStatus.BAD_REQUEST);
    }
    if (input.from && input.to && input.from > input.to) throw err('error.invoice.range_invalid', HttpStatus.BAD_REQUEST);
  }

  /** The would-be snapshot without a number and without any write (the creation screen's preview). */
  async preview(input: CreateInvoiceInput): Promise<InvoiceSnapshot> {
    // The screen previews before it knows the total: expectedTotal is optional here and never checked.
    this.checkFields(input.type === 'cases' && input.expectedTotal === undefined ? { ...input, expectedTotal: 0 } : input);
    return this.db.transaction(
      async (tx) => (await this.build(tx, input, 0, false)).snapshot,
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async create(input: CreateInvoiceInput, key: string, userId: number): Promise<InvoiceResult> {
    this.checkFields(input);
    const hash = requestHash(this.canonical(input));
    const replay = await this.replayOf(key, hash);
    if (replay) return replay;
    let id: number;
    try {
      id = await this.db.transaction(async (tx) => {
        await lockCurrencyForMoneyWrite(tx);
        if (input.doctorId !== undefined) {
          const doctor = await this.payments.lockDoctor(tx, input.doctorId);
          if (!doctor) throw notFound();
        }
        // The same key may have committed while we waited for the doctor lock.
        const again = await this.repo.byIdempotencyKey(tx, key);
        if (again) return -again.id;
        const no = await this.repo.takeInvoiceNo(tx);
        const built = await this.build(tx, input, no);
        return this.insert(tx, built, { key, hash }, userId);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'invoices_idempotency_key_uq')) {
        const raced = await this.replayOf(key, hash);
        if (raced) return raced;
      }
      if (isUniqueViolation(error, 'invoice_cases_active_case_uq')) {
        throw err('error.invoice.case_already_invoiced', HttpStatus.CONFLICT, { caseNo: '' });
      }
      throw error;
    }
    if (id < 0) {
      const raced = await this.replayOf(key, hash);
      if (raced) return raced;
      throw notFound();
    }
    return { invoice: await this.get(id), replayed: false };
  }

  private async replayOf(key: string, hash: string): Promise<InvoiceResult | undefined> {
    const existing = await this.repo.byIdempotencyKey(this.db, key);
    if (!existing) return undefined;
    if (existing.requestHash !== hash) throw err('error.idempotency.mismatch', HttpStatus.UNPROCESSABLE_ENTITY);
    return { invoice: await this.get(existing.id), replayed: true };
  }

  private async insert(tx: Tx, b: Built, idem: { key: string; hash: string }, userId: number): Promise<number> {
    const s = b.snapshot;
    if (b.logo) await this.repo.freezeImage(tx, b.logo);
    const totals = s.type === 'statement' ? null : s.totals;
    const id = await this.repo.insert(
      tx,
      {
        no: s.no,
        type: s.type,
        doctorId: b.doctorId,
        partyName: b.partyName,
        issueDate: s.issueDate,
        language: s.language,
        currencyCode: b.currencyCode,
        subtotal: totals?.subtotal ?? null,
        discount: totals?.discount ?? null,
        total: totals?.total ?? null,
        snapshot: s,
        snapshotVersion: s.version,
        snapshotSha256: snapshotSha256(s),
        logoSha256: b.logo?.sha256 ?? null,
        idempotencyKey: idem.key,
        requestHash: idem.hash,
      },
      userId,
    );
    await this.repo.linkCases(tx, id, b.caseIds);
    await this.audit.write(tx, {
      userId,
      action: 'invoice.created',
      entity: 'invoice',
      entityId: id,
      params: {
        invoiceNo: s.no,
        type: s.type,
        party: b.partyName,
        total: totals?.total ?? null,
        caseCount: b.caseIds.length,
      },
    });
    return id;
  }

  /** Everything printed, read under the caller's locks (create) or snapshot (preview). */
  private async build(tx: Tx, input: CreateInvoiceInput, no: number, lock = true): Promise<Built> {
    const [profile, currency, language, template, logo, issueDate] = await Promise.all([
      this.settings.get<LabProfile>(tx, LAB_PROFILE),
      this.settings.get<CurrencySetting>(tx, CURRENCY),
      this.settings.get<LanguageSetting>(tx, LANGUAGE),
      this.templates.get(tx),
      this.logos.file(tx),
      this.calendar.today(tx),
    ]);
    if (!profile || !currency) throw new Error('settings missing (setup not completed)');
    const frozenLogo = logo ? { sha256: sha256Hex(logo.content), mimeType: logo.mimeType, content: logo.content } : null;
    const lab: InvoiceLab = {
      nameAr: profile.value.nameAr,
      nameEn: profile.value.nameEn,
      phone: profile.value.phone,
      address: profile.value.address,
      slogan: profile.value.slogan ?? null,
      logo: frozenLogo ? { sha256: frozenLogo.sha256, mimeType: frozenLogo.mimeType } : null,
    };
    const base = {
      version: INVOICE_SNAPSHOT_VERSION,
      no,
      issueDate,
      language: input.language ?? language?.value.documents ?? 'ar',
      lab,
      currency: { code: currency.value.code, symbol: currency.value.symbol, decimals: currency.value.decimals },
      layout: layoutOf(template.template),
      notes: input.notes ?? null,
    } as const;

    let party: InvoiceParty;
    let doctorId: number | null = null;
    if (input.doctorId !== undefined) {
      const d = await this.repo.doctor(tx, input.doctorId);
      if (!d) throw notFound();
      party = { kind: 'doctor', doctorId: d.id, name: d.name, clinic: d.clinic, phone: d.phone };
      doctorId = d.id;
    } else {
      party = { kind: 'free', name: input.partyName ?? '' };
    }
    const common = { lab, currencyCode: currency.value.code, logo: frozenLogo, doctorId, partyName: party.name };

    if (input.type === 'free') {
      const amount = input.amount ?? 0;
      const snapshot: FreeInvoiceSnapshot = {
        ...base,
        type: 'free',
        party,
        free: { reason: input.reason ?? '', amount },
        totals: { subtotal: amount, discount: 0, total: amount },
      };
      return { ...common, snapshot, caseIds: [] };
    }

    if (input.type === 'statement') {
      const id = doctorId as number;
      const ledgerInput = await this.ledgerRepo.doctorInput(tx, id);
      if (!ledgerInput) throw notFound();
      const r = await this.ledgerRepo.statement(tx, id, ledgerInput.opening, { from: input.from, to: input.to }, 0, MAX_STATEMENT_LINES + 1);
      if (r.total > MAX_STATEMENT_LINES) {
        throw err('error.invoice.statement_too_long', HttpStatus.BAD_REQUEST, { max: MAX_STATEMENT_LINES });
      }
      const balance = await this.ledger.balance(id, tx);
      const snapshot: StatementInvoiceSnapshot = {
        ...base,
        type: 'statement',
        party,
        statement: {
          from: input.from ?? null,
          to: input.to ?? null,
          openingBalance: ledgerInput.opening,
          periodOpening: r.periodOpening,
          lines: r.lines.map((l) => ({
            date: l.date,
            kind: l.kind,
            ref:
              l.kind === 'case'
                ? l.ref
                : formatVoucher(Number(l.ref), l.kind === 'refund' || l.kind === 'refund_cheque_return' ? 'out' : 'in'),
            patientName: l.patientName,
            method: l.method,
            chequeNo: l.chequeNo,
            bank: l.bank,
            boundCaseNo: l.boundCaseNo,
            debit: l.debit,
            credit: l.credit,
            running: l.running,
          })),
          totals: { debit: r.totalDebit, credit: r.totalCredit },
          closing: r.periodOpening + r.periodNet,
          pendingCheques: balance.pendingCheques,
        },
      };
      this.assertConsistent(snapshot);
      return { ...common, snapshot, caseIds: [] };
    }

    // ---- cases ----
    const id = doctorId as number;
    const ids = input.caseIds ?? [];
    const locked = await this.repo.lockCases(tx, ids, lock);
    if (locked.length !== ids.length) throw notFound();
    const active = await this.repo.activeInvoicesOf(tx, ids);
    for (const c of [...locked].sort((a, b) => a.caseNo - b.caseNo)) {
      if (c.doctorId !== id) throw err('error.invoice.case_doctor_mismatch', HttpStatus.CONFLICT, { caseNo: c.caseNo });
      const on = active.get(c.id);
      if (on) throw err('error.invoice.case_already_invoiced', HttpStatus.CONFLICT, { caseNo: c.caseNo, invoiceNo: on.no });
      if (!isInvoiceable(c.status)) throw err('error.invoice.case_not_eligible', HttpStatus.CONFLICT, { caseNo: c.caseNo });
    }
    const ordered = [...locked].sort((a, b) => a.caseNo - b.caseNo);
    const items = await this.repo.items(tx, ids);
    const byCase = new Map(ordered.map((c) => [c.id, c]));
    const lines = groupInvoiceLines(
      ordered.flatMap((c) =>
        items
          .filter((i) => i.caseId === c.id)
          .map((i) => ({
            caseNo: c.caseNo,
            patientName: byCase.get(i.caseId)?.patientName ?? '',
            workTypeName: i.workTypeName,
            shade: i.shade,
            unitPrice: i.unitPrice,
            toothNo: i.toothNo,
            area: i.area,
          })),
      ),
    );
    const discount = sumMinor(ordered.map((c) => c.discount));
    const totals = invoiceTotals(lines, discount);
    if (totals.total !== sumMinor(ordered.map((c) => c.total))) {
      this.logger.error(`invoice totals do not match the case totals for cases ${ids.join(',')}`);
      throw new Error('invoice totals invariant failed'); // 500 error.internal
    }
    if (input.expectedTotal !== undefined && input.expectedTotal !== totals.total) {
      throw err('error.invoice.total_changed', HttpStatus.CONFLICT, { total: totals.total });
    }
    const figures = await this.ledger.figuresForCases(ordered, tx);
    const balance = await this.ledger.balance(id, tx);
    const snapshot: CasesInvoiceSnapshot = {
      ...base,
      type: 'cases',
      party,
      cases: ordered.map((c) => ({
        caseNo: c.caseNo,
        patientName: c.patientName,
        receivedDate: c.receivedDate,
        deliveredDate: c.deliveredDate,
        status: c.status,
        subtotal: c.total + c.discount,
        discount: c.discount,
        total: c.total,
        paid: figures.get(c.id)?.paid ?? 0,
        remaining: figures.get(c.id)?.remaining ?? 0,
      })),
      lines,
      totals,
      balances: { previous: balance.balance - totals.total, current: balance.balance, pendingCheques: balance.pendingCheques },
    };
    this.assertConsistent(snapshot);
    return { ...common, snapshot, caseIds: ordered.map((c) => c.id) };
  }

  /** The renderer's own check, run before anything is stored: a snapshot that would not print is a bug. */
  private assertConsistent(s: InvoiceSnapshot): void {
    const problems = verifySnapshotTotals(s);
    if (problems.length > 0) {
      this.logger.error(`invoice snapshot inconsistent: ${problems.join(',')}`);
      throw new Error('invoice snapshot invariant failed');
    }
  }

  // ------------------------------------------------------------ read

  /** One invoice; its hash is verified on every read (a mismatch is never shown: 500 + log). */
  async get(id: number, db: Database | Tx = this.db): Promise<InvoiceDetail> {
    const row = await this.repo.find(db, id);
    if (!row) throw notFound();
    return this.verified(row);
  }

  private verified(row: InvoiceWithSnapshot): InvoiceDetail {
    if (snapshotSha256(row.snapshot) !== row.snapshotSha256) {
      this.logger.error(`invoice ${row.no}: stored snapshot does not match its SHA-256`);
      throw new Error('invoice snapshot hash mismatch');
    }
    const rest: Partial<InvoiceWithSnapshot> = { ...row };
    delete rest.requestHash;
    return { ...(rest as InvoiceRow), snapshot: row.snapshot as InvoiceSnapshot };
  }

  async logo(id: number): Promise<{ mimeType: string; sizeBytes: number; content: Buffer; sha256: string }> {
    const row = await this.repo.find(this.db, id);
    if (!row?.logoSha256) throw notFound();
    const img = await this.repo.image(this.db, row.logoSha256);
    if (!img) throw notFound();
    return { ...img, sha256: row.logoSha256 };
  }

  async list(f: InvoiceFilter, page: number, pageSize: number) {
    const r = await this.repo.list(this.db, f, offsetOf({ page, pageSize }), pageSize);
    return { items: r.items, page, pageSize, total: r.total };
  }

  async summary(): Promise<{ active: Record<InvoiceType, number>; void: number }> {
    const rows = await this.repo.summary(this.db);
    const active: Record<InvoiceType, number> = { cases: 0, statement: 0, free: 0 };
    let voided = 0;
    for (const r of rows) {
      if (r.status === 'void') voided += r.n;
      else active[r.type as InvoiceType] += r.n;
    }
    return { active, void: voided };
  }

  /** «حالات منجزة غير مفوترة» of a doctor with paid / remaining (one batch, never per row). */
  async eligible(doctorId: number, page: number, pageSize: number) {
    const doctor = await this.repo.doctor(this.db, doctorId);
    if (!doctor) throw notFound();
    const r = await this.repo.eligible(this.db, doctorId, offsetOf({ page, pageSize }), pageSize);
    const figures = await this.ledger.figuresForCases(r.items);
    return {
      page,
      pageSize,
      total: r.total,
      doctor: { id: doctor.id, name: doctor.name },
      items: r.items.map((c) => ({
        ...c,
        paid: figures.get(c.id)?.paid ?? 0,
        remaining: figures.get(c.id)?.remaining ?? 0,
      })),
    };
  }

  // ------------------------------------------------------------ void

  /** Void, never delete (SPEC §7.6): its cases become un-invoiced; number and snapshot stay. */
  async void(id: number, rowVersion: number, reason: string, userId: number): Promise<InvoiceDetail> {
    const doctorId = await this.repo.doctorIdOf(this.db, id);
    if (doctorId === undefined) throw notFound();
    await this.db.transaction(async (tx) => {
      if (doctorId !== null) await this.payments.lockDoctor(tx, doctorId);
      const current = await this.repo.forUpdate(tx, id);
      if (current?.status === 'void') throw err('error.invoice.already_void', HttpStatus.CONFLICT);
      const inv = assertCurrent(current, rowVersion);
      await this.repo.markVoid(tx, id, reason, userId);
      await this.audit.write(tx, {
        userId,
        action: 'invoice.voided',
        entity: 'invoice',
        entityId: id,
        params: { invoiceNo: inv.no, type: inv.type, reason },
      });
    });
    return this.get(id);
  }

  // ------------------------------------------------------------ cases (S13)

  /** Active invoice of each case (the cases list and details show it; the rules lock edits with it). */
  activeInvoicesOf(caseIds: readonly number[], db: Database | Tx = this.db) {
    return this.repo.activeInvoicesOf(db, caseIds);
  }

  /** For the CSV export: the filtered list, newest first, capped. */
  listAll(f: InvoiceFilter, limit: number) {
    return this.repo.listAll(this.db, f, limit);
  }
}
