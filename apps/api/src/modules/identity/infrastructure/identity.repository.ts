import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Database, Tx } from '../../../shared/db/database';
import { refreshTokens, rolePermissions, roles, userRoles, users } from '../../../shared/db/schema';

type Executor = Database | Tx;

export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  active: boolean;
  mustChangePassword: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
}

export interface RefreshTokenRecord {
  id: number;
  userId: number;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  /** Set only when the token was rotated; presenting such a token again means replay. */
  replacedBy: number | null;
}

const userColumns = {
  id: users.id,
  username: users.username,
  passwordHash: users.passwordHash,
  active: users.active,
  mustChangePassword: users.mustChangePassword,
  failedLogins: users.failedLogins,
  lockedUntil: users.lockedUntil,
};

/** Arbitrary constant: serialises concurrent first-run setup attempts. */
const SETUP_LOCK_KEY = 4_310_002;

@Injectable()
export class IdentityRepository {
  async lockSetup(tx: Tx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
  }

  async anyUserExists(db: Executor): Promise<boolean> {
    const rows = await db.select({ id: users.id }).from(users).limit(1);
    return rows.length > 0;
  }

  async findByUsernameForUpdate(tx: Tx, username: string): Promise<UserRecord | undefined> {
    const rows = await tx
      .select(userColumns)
      .from(users)
      .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
      .for('update');
    return rows[0];
  }

  async findById(db: Executor, id: number, forUpdate = false): Promise<UserRecord | undefined> {
    const query = db.select(userColumns).from(users).where(eq(users.id, id));
    const rows = forUpdate ? await query.for('update') : await query;
    return rows[0];
  }

  async insertUser(tx: Tx, username: string, passwordHash: string): Promise<number> {
    const [row] = await tx.insert(users).values({ username, passwordHash }).returning({ id: users.id });
    if (!row) throw new Error('User insert returned no row');
    return row.id;
  }

  async assignRole(tx: Tx, userId: number, roleCode: string): Promise<void> {
    const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, roleCode));
    if (!role) throw new Error(`Role ${roleCode} is missing (migration not applied?)`);
    await tx.insert(userRoles).values({ userId, roleId: role.id });
  }

  async setLoginState(tx: Tx, userId: number, failedLogins: number, lockedUntil: Date | null): Promise<void> {
    await tx.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
  }

  async setPassword(tx: Tx, userId: number, passwordHash: string): Promise<void> {
    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        rowVersion: sql`${users.rowVersion} + 1`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(users.id, userId));
  }

  async permissionsOf(db: Executor, userId: number): Promise<string[]> {
    const rows = await db
      .selectDistinct({ code: rolePermissions.permissionCode })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .where(eq(userRoles.userId, userId))
      .orderBy(rolePermissions.permissionCode);
    return rows.map((r) => r.code);
  }

  async insertRefreshToken(
    tx: Tx,
    token: { userId: number; tokenHash: string; familyId: string; expiresAt: Date },
  ): Promise<number> {
    const [row] = await tx.insert(refreshTokens).values(token).returning({ id: refreshTokens.id });
    if (!row) throw new Error('Refresh token insert returned no row');
    return row.id;
  }

  async findRefreshTokenForUpdate(tx: Tx, tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    const rows = await tx
      .select({
        id: refreshTokens.id,
        userId: refreshTokens.userId,
        familyId: refreshTokens.familyId,
        expiresAt: refreshTokens.expiresAt,
        revokedAt: refreshTokens.revokedAt,
        replacedBy: refreshTokens.replacedBy,
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .for('update');
    return rows[0];
  }

  async markRotated(tx: Tx, id: number, replacedBy: number, now: Date): Promise<void> {
    await tx.update(refreshTokens).set({ revokedAt: now, replacedBy }).where(eq(refreshTokens.id, id));
  }

  /** Returns how many still-active tokens were revoked. */
  async revokeFamily(tx: Tx, familyId: string, now: Date): Promise<number> {
    const rows = await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length;
  }

  async revokeAllForUser(tx: Tx, userId: number, now: Date): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}
