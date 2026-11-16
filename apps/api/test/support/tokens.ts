import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { TestApp } from './app';

/** A valid access token that holds exactly these permissions (for 403 checks beyond `account.self`). */
export async function tokenWith(t: TestApp, perms: string[]): Promise<string> {
  const me = await request(t.http).get('/api/v1/auth/me').set('Authorization', t.auth).expect(200);
  const jwt = await new JwtService({ secret: t.config.jwt.accessSecret }).signAsync(
    { sub: String((me.body as { id: number }).id), perms },
    { algorithm: 'HS256', expiresIn: 600 },
  );
  return `Bearer ${jwt}`;
}
