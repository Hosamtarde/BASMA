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
} as const;

export type PermissionCode = (typeof Permission)[keyof typeof Permission];

export const OWNER_ROLE = 'owner';
