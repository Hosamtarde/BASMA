import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { DomainError } from '../../../shared/errors/domain-error';
import { afterFailedLogin, isLocked, LOGIN_MAX_FAILURES } from '../domain/login-lockout';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  mustChangePassword: boolean;
}

export interface CurrentUserProfile {
  id: number;
  username: string;
  permissions: string[];
  mustChangePassword: boolean;
}

const invalidCredentials = () => new DomainError('error.auth.invalid_credentials', HttpStatus.UNAUTHORIZED);
const invalidRefreshToken = () =>
  new DomainError('error.auth.invalid_refresh_token', HttpStatus.UNAUTHORIZED);

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: IdentityRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * One generic error for unknown user, inactive user, locked account and wrong password.
   * Failure counting must be committed, so the outcome is decided inside the transaction
   * and the error is thrown only after commit.
   */
  async login(username: string, password: string): Promise<SessionTokens> {
    const now = new Date();
    const outcome = await this.db.transaction(async (tx) => {
      const user = await this.repo.findByUsernameForUpdate(tx, username);
      if (!user || !user.active || isLocked(user, now)) {
        await this.hasher.burnTime(password);
        return { ok: false as const };
      }
      if (!(await this.hasher.verify(user.passwordHash, password))) {
        const next = afterFailedLogin(user, now);
        await this.repo.setLoginState(tx, user.id, next.failedLogins, next.lockedUntil);
        if (next.justLocked) {
          await this.audit.write(tx, {
            userId: user.id,
            action: 'auth.account_locked',
            entity: 'user',
            entityId: user.id,
            params: { attempts: LOGIN_MAX_FAILURES },
          });
        }
        return { ok: false as const };
      }
      if (user.failedLogins !== 0 || user.lockedUntil !== null) {
        await this.repo.setLoginState(tx, user.id, 0, null);
      }
      const tokens = await this.startSession(tx, user.id, randomUUID(), now, user.mustChangePassword);
      return { ok: true as const, tokens };
    });
    if (!outcome.ok) throw invalidCredentials();
    return outcome.tokens;
  }

  /**
   * Rotates the refresh token. Presenting an already-used token means it was stolen or replayed:
   * the whole token family is revoked (ADR-0004).
   */
  async refresh(refreshToken: string): Promise<SessionTokens> {
    const now = new Date();
    const outcome = await this.db.transaction(async (tx) => {
      const stored = await this.repo.findRefreshTokenForUpdate(
        tx,
        TokenService.hashRefreshToken(refreshToken),
      );
      if (!stored) return { ok: false as const };
      if (stored.revokedAt !== null) {
        // A rotated token presented again = replay: end the whole family. Tokens revoked by
        // logout/password change are simply invalid (no audit noise from client retries).
        if (stored.replacedBy !== null && (await this.repo.revokeFamily(tx, stored.familyId, now)) > 0) {
          await this.audit.write(tx, {
            userId: stored.userId,
            action: 'auth.refresh_token_reuse',
            entity: 'user',
            entityId: stored.userId,
          });
        }
        return { ok: false as const };
      }
      if (stored.expiresAt.getTime() <= now.getTime()) return { ok: false as const };
      const user = await this.repo.findById(tx, stored.userId);
      if (!user || !user.active) return { ok: false as const };

      const tokens = await this.startSession(
        tx,
        user.id,
        stored.familyId,
        now,
        user.mustChangePassword,
        stored.id,
      );
      return { ok: true as const, tokens };
    });
    if (!outcome.ok) throw invalidRefreshToken();
    return outcome.tokens;
  }

  /** Ends the session family of the given refresh token. Idempotent; foreign or unknown tokens are ignored. */
  async logout(userId: number, refreshToken: string): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const stored = await this.repo.findRefreshTokenForUpdate(
        tx,
        TokenService.hashRefreshToken(refreshToken),
      );
      if (stored && stored.userId === userId) await this.repo.revokeFamily(tx, stored.familyId, now);
    });
  }

  /** Changes the own password and ends every session of the user. */
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const newHash = await this.hasher.hash(newPassword);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const user = await this.repo.findById(tx, userId, true);
      if (!user || !user.active) throw new DomainError('error.auth.unauthenticated', HttpStatus.UNAUTHORIZED);
      if (!(await this.hasher.verify(user.passwordHash, currentPassword))) {
        throw new DomainError('error.auth.wrong_current_password', HttpStatus.BAD_REQUEST);
      }
      await this.repo.setPassword(tx, userId, newHash);
      await this.repo.revokeAllForUser(tx, userId, now);
      await this.audit.write(tx, {
        userId,
        action: 'auth.password_changed',
        entity: 'user',
        entityId: userId,
      });
    });
  }

  async me(userId: number): Promise<CurrentUserProfile> {
    const user = await this.repo.findById(this.db, userId);
    if (!user || !user.active) throw new DomainError('error.auth.unauthenticated', HttpStatus.UNAUTHORIZED);
    const permissions = await this.repo.permissionsOf(this.db, userId);
    return { id: user.id, username: user.username, permissions, mustChangePassword: user.mustChangePassword };
  }

  private async startSession(
    tx: Tx,
    userId: number,
    familyId: string,
    now: Date,
    mustChangePassword: boolean,
    rotatedTokenId?: number,
  ): Promise<SessionTokens> {
    const refresh = this.tokens.newRefreshToken(now);
    const newId = await this.repo.insertRefreshToken(tx, {
      userId,
      tokenHash: refresh.hash,
      familyId,
      expiresAt: refresh.expiresAt,
    });
    if (rotatedTokenId !== undefined) await this.repo.markRotated(tx, rotatedTokenId, newId, now);
    const permissions = await this.repo.permissionsOf(tx, userId);
    return {
      accessToken: await this.tokens.signAccessToken(userId, permissions),
      accessTokenExpiresIn: this.tokens.accessTtlSeconds,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
      mustChangePassword,
    };
  }
}
