import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { DomainError } from '../../../shared/errors/domain-error';
import { AuthService, SessionTokens } from '../application/auth.service';
import { Permission } from '../domain/permissions';
import { CurrentUser, Public, RequirePermission } from './auth.decorators';
import type { AuthUser } from './auth.decorators';
import { ChangePasswordRequest, LoginRequest, MeResponse, TokenResponse } from './dto';
import {
  assertSameOrigin,
  clearRefreshCookie,
  readRefreshCookie,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  setRefreshCookie,
} from './refresh-cookie';

/** The access token goes in the body (the UI keeps it in memory only); the refresh token only in the cookie. */
function issue(req: Request, res: Response, t: SessionTokens): TokenResponse {
  setRefreshCookie(req, res, t.refreshToken, t.refreshTokenExpiresAt);
  return {
    accessToken: t.accessToken,
    accessTokenExpiresIn: t.accessTokenExpiresIn,
    refreshTokenExpiresAt: t.refreshTokenExpiresAt.toISOString(),
    mustChangePassword: t.mustChangePassword,
  };
}

const invalidRefreshToken = () =>
  new DomainError('error.auth.invalid_refresh_token', HttpStatus.UNAUTHORIZED);
const COOKIE_NOTE = `The refresh token is set as the httpOnly, SameSite=Strict cookie "${REFRESH_COOKIE}" (path ${REFRESH_COOKIE_PATH}); it is never in the body.`;

@ApiTags('auth')
@UseGuards(ThrottlerGuard)
@ApiTooManyRequestsResponse({ description: 'error.rate_limited' })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with username and password', description: COOKIE_NOTE })
  @ApiOkResponse({ type: TokenResponse })
  @ApiUnauthorizedResponse({ description: 'error.auth.invalid_credentials' })
  async login(
    @Body() body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    return issue(req, res, await this.auth.login(body.username, body.password));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({
    summary: 'Exchange the refresh cookie for a new access token and a rotated cookie',
    description: `${COOKIE_NOTE} Reusing an already rotated token ends the whole session family.`,
  })
  @ApiOkResponse({ type: TokenResponse })
  @ApiUnauthorizedResponse({ description: 'error.auth.invalid_refresh_token' })
  @ApiForbiddenResponse({ description: 'error.auth.forbidden (cross-origin request)' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<TokenResponse> {
    assertSameOrigin(req.headers);
    const token = readRefreshCookie(req.headers.cookie);
    if (token === null) throw invalidRefreshToken();
    try {
      return issue(req, res, await this.auth.refresh(token));
    } catch (err) {
      // A dead cookie is useless to the browser; drop it so the UI goes straight to login.
      clearRefreshCookie(req, res);
      throw err;
    }
  }

  @Post('logout')
  @RequirePermission(Permission.AccountSelf)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({ summary: 'End the session of the refresh cookie and clear the cookie' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'error.auth.unauthenticated' })
  @ApiForbiddenResponse({ description: 'error.auth.forbidden (cross-origin request)' })
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    assertSameOrigin(req.headers);
    const token = readRefreshCookie(req.headers.cookie);
    if (token !== null) await this.auth.logout(user.id, token);
    clearRefreshCookie(req, res);
  }

  @Post('change-password')
  @RequirePermission(Permission.AccountSelf)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change own password; ends all sessions and clears the refresh cookie' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'error.validation.failed | error.auth.wrong_current_password' })
  @ApiUnauthorizedResponse({ description: 'error.auth.unauthenticated' })
  @ApiForbiddenResponse({ description: 'error.auth.forbidden' })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    clearRefreshCookie(req, res);
  }

  @Get('me')
  @RequirePermission(Permission.AccountSelf)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user and permissions' })
  @ApiOkResponse({ type: MeResponse })
  @ApiUnauthorizedResponse({ description: 'error.auth.unauthenticated' })
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }
}
