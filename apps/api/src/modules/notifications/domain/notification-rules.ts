import { addDays } from '../../../shared/time/lab-date';
import type { CaseStatus } from '../../cases/domain/case-rules';

/**
 * Notifications feed (SPEC §5.16; B5 plan §5, owner decisions N5–N8). Items are computed at read
 * time from the cases and cheques and never stored; only what a user has seen or hidden is kept,
 * under a key that names one item in one phase.
 */
export const NOTIFICATION_TYPES = ['case_due', 'cheque_in_due', 'cheque_out_due', 'collect_due'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_PHASES = ['soon', 'overdue', 'due'] as const;
export type NotificationPhase = (typeof NOTIFICATION_PHASES)[number];

/** A case is "due soon" from 2 days before its expected date (SPEC §5.16). */
export const CASE_DUE_SOON_DAYS = 2;
/** Read / hidden marks of items that no longer appear are purged after this many days (N8). */
export const STATE_RETENTION_DAYS = 180;
/** Most items listed per type; the total per type is always exact. */
export const MAX_ITEMS_PER_TYPE = 20;

/** Cases still in the lab (N5): any status before delivery, or returned to the lab. */
export const IN_LAB_STATUSES: readonly CaseStatus[] = ['waiting', 'design', 'in_progress', 'ready', 'returned'];

/** Phase of a dated item, or null when it is not yet near (shared by cases and cheques). */
export function duePhase(date: string, today: string, soonDays: number): 'soon' | 'overdue' | null {
  if (date < today) return 'overdue';
  return date <= addDays(today, soonDays) ? 'soon' : null;
}

/** «تحصيل مستحق»: the collect date has come and something is still owed on the case. */
export const collectPhase = (collectOn: string, today: string, remaining: number): 'due' | null =>
  collectOn <= today && remaining > 0 ? 'due' : null;

/**
 * `type:entityId:phase:date`. A phase or a date change gives a new key, so a hidden "soon" item
 * comes back as "overdue", and a moved date shows again (N6). Always ≤ 100 characters.
 */
export const notificationKey = (type: NotificationType, entityId: number, phase: NotificationPhase, date: string): string =>
  `${type}:${entityId}:${phase}:${date}`;

/** What each type needs on top of `notifications.read` (the feed never shows more than the screens). */
export const TYPE_PERMISSIONS: Record<NotificationType, readonly string[]> = {
  case_due: ['cases.read'],
  cheque_in_due: ['cheques.read'],
  cheque_out_due: ['cheques.read', 'expenses.read'],
  collect_due: ['cases.read', 'ledger.read'],
};

export const visibleTypes = (permissions: readonly string[]): NotificationType[] =>
  NOTIFICATION_TYPES.filter((t) => TYPE_PERMISSIONS[t].every((p) => permissions.includes(p)));
