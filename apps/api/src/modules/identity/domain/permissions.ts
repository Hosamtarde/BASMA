/**
 * Permission codes. Each must also exist in the `permissions` table (added by migration)
 * and be granted to the `owner` role. Routes without a declared permission are denied.
 */
export const Permission = {
  /** Own session and password (logout, change password, me). */
  AccountSelf: 'account.self',
} as const;

export type PermissionCode = (typeof Permission)[keyof typeof Permission];

export const OWNER_ROLE = 'owner';
