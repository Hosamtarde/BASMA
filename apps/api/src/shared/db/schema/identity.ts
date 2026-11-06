import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: id(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    active: boolean('active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    createdBy: bigint('created_by', { mode: 'number' }).references((): AnyPgColumn => users.id, {
      onDelete: 'restrict',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }).references((): AnyPgColumn => users.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    uniqueIndex('users_username_lower_uq').on(sql`lower(${t.username})`),
    check('users_username_length_ck', sql`char_length(${t.username}) between 3 and 50`),
    check('users_failed_logins_ck', sql`${t.failedLogins} >= 0`),
    check('users_row_version_ck', sql`${t.rowVersion} >= 1`),
  ],
);

export const roles = pgTable('roles', {
  id: id(),
  code: text('code').notNull().unique('roles_code_uq'),
  createdAt: createdAt(),
});

export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ name: 'role_permissions_pk', columns: [t.roleId, t.permissionCode] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ name: 'user_roles_pk', columns: [t.userId, t.roleId] })],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** SHA-256 of the token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique('refresh_tokens_token_hash_uq'),
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: bigint('replaced_by', { mode: 'number' }).references((): AnyPgColumn => refreshTokens.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    // Revoke-all-for-user (password change) and revoke-family (reuse detection).
    index('refresh_tokens_user_id_ix').on(t.userId),
    index('refresh_tokens_family_id_ix').on(t.familyId),
  ],
);
