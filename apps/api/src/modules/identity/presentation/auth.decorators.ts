import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { PermissionCode } from '../domain/permissions';

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_PERMISSION = 'auth:permission';

/** Opt-out of authentication (setup, login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Every non-public route must declare its permission; undeclared routes are denied (ADR-0004). */
export const RequirePermission = (permission: PermissionCode) => SetMetadata(REQUIRED_PERMISSION, permission);

export interface AuthUser {
  id: number;
  permissions: string[];
}

export type AuthenticatedRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});
