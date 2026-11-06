import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DomainError } from '../../../shared/errors/domain-error';
import { AuthGuard } from './auth.guard';
import { AuthenticatedRequest, IS_PUBLIC, REQUIRED_PERMISSION } from './auth.decorators';

const SECRET = 'unit-test-secret-unit-test-secret-1234';

function contextFor(metadata: Record<string, unknown>, authorization?: string) {
  const handler = () => undefined;
  class TestController {}
  for (const [key, value] of Object.entries(metadata)) Reflect.defineMetadata(key, value, handler);
  const req = { headers: { authorization } } as AuthenticatedRequest;
  const ctx = {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

describe('AuthGuard', () => {
  const jwt = new JwtService({ secret: SECRET, signOptions: { algorithm: 'HS256', expiresIn: 60 } });
  const guard = new AuthGuard(new Reflector(), jwt);
  const token = (perms: string[], sub = '7') => jwt.signAsync({ sub, perms });

  it('lets public routes through without a token', async () => {
    await expect(guard.canActivate(contextFor({ [IS_PUBLIC]: true }).ctx)).resolves.toBe(true);
  });

  it('rejects missing, malformed and wrongly signed tokens with 401', async () => {
    const meta = { [REQUIRED_PERMISSION]: 'account.self' };
    expect(await codeOf(guard.canActivate(contextFor(meta).ctx))).toBe('error.auth.unauthenticated');
    expect(await codeOf(guard.canActivate(contextFor(meta, 'Bearer nope').ctx))).toBe(
      'error.auth.unauthenticated',
    );
    const forged = await new JwtService({ secret: 'another-secret-another-secret-12345' }).signAsync({
      sub: '7',
      perms: ['account.self'],
    });
    expect(await codeOf(guard.canActivate(contextFor(meta, `Bearer ${forged}`).ctx))).toBe(
      'error.auth.unauthenticated',
    );
  });

  it('denies by default when a route declares no permission (403)', async () => {
    const { ctx } = contextFor({}, `Bearer ${await token(['account.self'])}`);
    expect(await codeOf(guard.canActivate(ctx))).toBe('error.auth.forbidden');
  });

  it('denies when the token lacks the required permission, allows when present', async () => {
    const meta = { [REQUIRED_PERMISSION]: 'payments.void' };
    expect(
      await codeOf(guard.canActivate(contextFor(meta, `Bearer ${await token(['account.self'])}`).ctx)),
    ).toBe('error.auth.forbidden');
    const { ctx, req } = contextFor(meta, `Bearer ${await token(['payments.void'])}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ id: 7, permissions: ['payments.void'] });
  });
});
