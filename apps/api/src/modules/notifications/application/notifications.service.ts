import { Inject, Injectable } from '@nestjs/common';
import { formatMoney } from '@app/shared';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { I18nService, Language } from '../../../shared/i18n/i18n.service';
import { addDays } from '../../../shared/time/lab-date';
import { LedgerService } from '../../payments/application/ledger.service';
import { CHEQUE_DUE_SOON_DAYS, formatVoucher } from '../../payments/domain/payment-rules';
import { LabCalendar } from '../../settings/application/lab-calendar.service';
import { CURRENCY, CurrencySetting } from '../../settings/domain/settings-rules';
import { SettingsRepository } from '../../settings/infrastructure/settings.repository';
import {
  CASE_DUE_SOON_DAYS,
  collectPhase,
  MAX_ITEMS_PER_TYPE,
  NotificationPhase,
  notificationKey,
  NotificationType,
  visibleTypes,
} from '../domain/notification-rules';
import { DatedRow, DatedType, NotificationsRepository } from '../infrastructure/notifications.repository';

export type NotificationEntity =
  | { kind: 'case'; id: number }
  | { kind: 'cheque'; id: number; direction: 'in' | 'out'; chequeNo: string };

export interface NotificationItem {
  key: string;
  type: NotificationType;
  phase: NotificationPhase;
  date: string;
  entity: NotificationEntity;
  params: Record<string, string | number>;
  text: string;
  seen: boolean;
}

export interface NotificationGroup {
  type: NotificationType;
  /** Items of this type not hidden by the user (exact, whatever the list limit). */
  total: number;
  unread: number;
  items: NotificationItem[];
}

export interface NotificationFeed {
  today: string;
  unread: number;
  total: number;
  groups: NotificationGroup[];
}

export interface Caller {
  id: number;
  permissions: readonly string[];
}

/** An item before its text: what a group returns. */
type RawItem = Omit<NotificationItem, 'text'>;

const SOON_DAYS: Record<DatedType, number> = {
  case_due: CASE_DUE_SOON_DAYS,
  cheque_in_due: CHEQUE_DUE_SOON_DAYS,
  cheque_out_due: CHEQUE_DUE_SOON_DAYS,
};

/**
 * Notifications feed (SPEC §5.16, B5 plan §5): computed at read time from cases and cheques in one
 * read-only snapshot; only per-user "seen" / "hidden" marks are stored (N6, N7). Cases and cheques are
 * counted and paged in SQL (one statement per type); the collect reminder needs the FIFO figures, so
 * it runs `allocate` for the doctors who still owe something. Texts come from the API catalogs in
 * the caller's language (SPEC §6.1).
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: NotificationsRepository,
    private readonly ledger: LedgerService,
    private readonly calendar: LabCalendar,
    private readonly settings: SettingsRepository,
    private readonly i18n: I18nService,
  ) {}

  async feed(caller: Caller, language: Language, limit = MAX_ITEMS_PER_TYPE): Promise<NotificationFeed> {
    return this.snapshot(async (tx) => {
      const today = await this.calendar.today(tx);
      const currency = (await this.settings.get<CurrencySetting>(tx, CURRENCY))?.value;
      const money = (minor: number) =>
        currency ? `${formatMoney(minor, currency.decimals)} ${currency.symbol}` : String(minor);
      const groups: NotificationGroup[] = [];
      for (const type of visibleTypes(caller.permissions)) {
        const g = await this.group(tx, type, caller.id, today, limit);
        groups.push({
          type,
          total: g.total,
          unread: g.unread,
          items: g.items.map((i) => ({
            ...i,
            text: this.i18n.translate(
              `notification.${i.type}.${i.phase}`,
              { ...i.params, ...(typeof i.params.amount === 'number' ? { amount: money(i.params.amount) } : {}) },
              language,
            ),
          })),
        });
      }
      return {
        today,
        unread: groups.reduce((s, g) => s + g.unread, 0),
        total: groups.reduce((s, g) => s + g.total, 0),
        groups,
      };
    });
  }

  /** The bell's badge: the same groups, counts only. */
  async count(caller: Caller): Promise<{ unread: number; total: number }> {
    return this.snapshot(async (tx) => {
      const today = await this.calendar.today(tx);
      let unread = 0;
      let total = 0;
      for (const type of visibleTypes(caller.permissions)) {
        const g = await this.group(tx, type, caller.id, today, 0);
        unread += g.unread;
        total += g.total;
      }
      return { unread, total };
    });
  }

  /**
   * Marks items seen, hidden or shown again. Keys the caller is not shown right now are ignored (a
   * client cannot fill the table with arbitrary keys); marks of items gone for longer than the
   * retention are dropped on the way (N8, no scheduler).
   */
  async mark(caller: Caller, keys: readonly string[], change: { seen?: true; dismissed?: boolean }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const today = await this.calendar.today(tx);
      const live = await this.liveKeys(tx, caller, today, [...new Set(keys)]);
      await this.repo.mark(tx, caller.id, live, change);
      const states = await this.repo.states(tx, caller.id);
      const old = [...states].filter(([, st]) => st.old).map(([k]) => k);
      const stillShown = new Set(await this.liveKeys(tx, caller, today, old));
      await this.repo.purge(
        tx,
        caller.id,
        old.filter((k) => !stillShown.has(k)),
      );
    });
  }

  private snapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  private async group(
    tx: Tx,
    type: NotificationType,
    userId: number,
    today: string,
    limit: number,
  ): Promise<{ total: number; unread: number; items: RawItem[] }> {
    if (type === 'collect_due') {
      const states = await this.repo.states(tx, userId);
      const shown = (await this.collectItems(tx, today)).filter((i) => !states.get(i.key)?.dismissed);
      const seen = (i: RawItem) => states.get(i.key)?.seen ?? false;
      return {
        total: shown.length,
        unread: shown.filter((i) => !seen(i)).length,
        items: shown.slice(0, limit).map((i) => ({ ...i, seen: seen(i) })),
      };
    }
    const g = await this.repo.datedGroup(tx, type, userId, today, addDays(today, SOON_DAYS[type]), limit);
    return { total: g.total, unread: g.unread, items: g.rows.map((r) => this.datedItem(type, r)) };
  }

  private datedItem(type: DatedType, r: DatedRow): RawItem {
    const base = { key: r.key, type, phase: r.phase, date: r.date, seen: r.seen };
    if (type === 'case_due') {
      return {
        ...base,
        entity: { kind: 'case', id: r.id },
        params: { caseNo: r.caseNo, doctor: r.doctorName, patient: r.patientName, date: r.date },
      };
    }
    const direction = type === 'cheque_in_due' ? 'in' : 'out';
    return {
      ...base,
      entity: { kind: 'cheque', id: r.id, direction, chequeNo: r.chequeNo },
      params: {
        chequeNo: r.chequeNo,
        bank: r.bank,
        party: r.party,
        amount: r.amount,
        voucher: formatVoucher(r.voucherNo, direction),
        date: r.date,
      },
    };
  }

  /**
   * «تحصيل مستحق» items in date order. A case can still be owed only when its doctor's balance is
   * positive (FIFO: credit means every charge is covered), so `allocate` runs for those doctors only.
   */
  private async collectItems(tx: Tx, today: string): Promise<RawItem[]> {
    const rows = await this.repo.collectCases(tx, today);
    if (rows.length === 0) return [];
    const balances = await this.ledger.balancesOf([...new Set(rows.map((r) => r.doctorId))], tx);
    const owing = rows.filter((r) => (balances.get(r.doctorId)?.balance ?? 0) > 0);
    const figures = await this.ledger.figuresForCases(owing, tx);
    const items: RawItem[] = [];
    for (const c of owing) {
      const remaining = figures.get(c.id)?.remaining ?? 0;
      const phase = collectPhase(c.collectOn, today, remaining);
      if (!phase) continue;
      items.push({
        key: notificationKey('collect_due', c.id, phase, c.collectOn),
        type: 'collect_due',
        phase,
        date: c.collectOn,
        seen: false,
        entity: { kind: 'case', id: c.id },
        params: { caseNo: c.caseNo, doctor: c.doctorName, patient: c.patientName, amount: remaining, date: c.collectOn },
      });
    }
    return items;
  }

  /** The subset of `keys` the caller's feed generates now (any phase, hidden or not). */
  private async liveKeys(tx: Tx, caller: Caller, today: string, keys: readonly string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const types = visibleTypes(caller.permissions);
    const live: string[] = [];
    for (const type of types) {
      const mine = keys.filter((k) => k.startsWith(`${type}:`));
      if (mine.length === 0) continue;
      if (type === 'collect_due') {
        const current = new Set((await this.collectItems(tx, today)).map((i) => i.key));
        live.push(...mine.filter((k) => current.has(k)));
      } else {
        live.push(...(await this.repo.liveDatedKeys(tx, type, today, addDays(today, SOON_DAYS[type]), mine)));
      }
    }
    return live;
  }
}

