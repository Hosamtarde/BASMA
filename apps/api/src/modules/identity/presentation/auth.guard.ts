import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DomainError } from '../../../shared/errors/domain-error';
import { AccessTokenPayload } from '../application/token.service';
import { AuthenticatedRequest, IS_PUBLIC, REQUIRED_PERMISSION } from './auth.decorators';

/** Global guard: authenticates the bearer token, then checks the route's declared permission. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const payload = await this.verify(req.headers.authorization);
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Array.isArray(payload.perms)) {
      throw new DomainError('error.auth.unauthenticated', HttpStatus.UNAUTHORIZED);
    }
    req.user = { id: userId, permissions: payload.perms };

    const required = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_PERMISSION, targets);
    if (!required || !payload.perms.includes(required)) {
      throw new DomainError('error.auth.forbidden', HttpStatus.FORBIDDEN);
    }
    return true;
  }

  private async verify(header: string | undefined): Promise<AccessTokenPayload> {
    const [scheme, token] = (header ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new DomainError('error.auth.unauthenticated', HttpStatus.UNAUTHORIZED);
    }
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw new DomainError('error.auth.unauthenticated', HttpStatus.UNAUTHORIZED);
    }
  }
}
