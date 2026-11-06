import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AppConfig } from '../../../config/app-config';
import { APP_CONFIG } from '../../../config/config.module';

export interface AccessTokenPayload {
  sub: string;
  perms: string[];
}

export interface IssuedRefreshToken {
  token: string;
  hash: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.jwt.accessTtlSeconds;
  }

  signAccessToken(userId: number, permissions: string[]): Promise<string> {
    const payload: AccessTokenPayload = { sub: String(userId), perms: permissions };
    return this.jwt.signAsync(payload);
  }

  /** 256-bit random token; only its SHA-256 is stored (ADR-0004). */
  newRefreshToken(now: Date): IssuedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.config.refreshTokenTtlDays * 86_400_000);
    return { token, hash: TokenService.hashRefreshToken(token), expiresAt };
  }

  static hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
