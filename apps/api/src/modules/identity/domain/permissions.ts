/**
 * Permission codes. Each must also exist in the `permissions` table (added by migration)
 * and be granted to the `owner` role. Routes without a declared permission are denied.
 */
export const Permission = {
  /** Own session and password (logout, change password, me). */
  AccountSelf: 'account.self',
  DoctorsRead: 'doctors.read',
  DoctorsWrite: 'doctors.write',
  CatalogRead: 'catalog.read',
  CatalogWrite: 'catalog.write',
  SettingsRead: 'settings.read',
  SettingsWrite: 'settings.write',
  CasesRead: 'cases.read',
  CasesWrite: 'cases.write',
  CasesCancel: 'cases.cancel',
  PaymentsRead: 'payments.read',
  PaymentsWrite: 'payments.write',
  PaymentsVoid: 'payments.void',
  ChequesRead: 'cheques.read',
  ChequesWrite: 'cheques.write',
  LedgerRead: 'ledger.read',
  /** Take data out as a file (CSV); on top of the permission to read it (B4). */
  ExportsRun: 'exports.run',
  /** Global search; each result group also needs its own read permission (B4). */
  SearchUse: 'search.use',
} as const;

export type PermissionCode = (typeof Permission)[keyof typeof Permission];

export const OWNER_ROLE = 'owner';
