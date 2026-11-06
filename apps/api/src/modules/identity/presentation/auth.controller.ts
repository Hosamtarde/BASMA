import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService, SessionTokens } from '../application/auth.service';
import { Permission } from '../domain/permissions';
import { CurrentUser, Public, RequirePermission } from './auth.decorators';
import type { AuthUser } from './auth.decorators';
import { ChangePasswordRequest, LoginRequest, MeResponse, RefreshTokenRequest, TokenResponse } from './dto';

const toTokenResponse = (t: SessionTokens): TokenResponse => ({
  accessToken: t.accessToken,
  accessTokenExpiresIn: t.accessTokenExpiresIn,
  refreshToken: t.refreshToken,
  refreshTokenExpiresAt: t.refreshTokenExpiresAt.toISOString(),
  mustChangePassword: t.mustChangePassword,
});

@ApiTags('auth')
@UseGuards(ThrottlerGuard)
@ApiTooManyRequestsResponse({ description: 'error.rate_limited' })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with username and password' })
  @ApiOkResponse({ type: TokenResponse })
  @ApiUnauthorizedResponse({ description: 'error.auth.invalid_credentials' })
  async login(@Body() body: LoginRequest): Promise<TokenResponse> {
    return toTokenResponse(await this.auth.login(body.username, body.password));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair (rotation)' })
  @ApiOkResponse({ type: TokenResponse })
  @ApiUnauthorizedResponse({ description: 'error.auth.invalid_refresh_token' })
  async refresh(@Body() body: RefreshTokenRequest): Promise<TokenResponse> {
    return toTokenResponse(await this.auth.refresh(body.refreshToken));
  }

  @Post('logout')
  @RequirePermission(Permission.AccountSelf)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End the session of the given refresh token' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'error.auth.unauthenticated' })
  async logout(@CurrentUser() user: AuthUser, @Body() body: RefreshTokenRequest): Promise<void> {
    await this.auth.logout(user.id, body.refreshToken);
  }

  @Post('change-password')
  @RequirePermission(Permission.AccountSelf)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change own password; ends all sessions' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'error.validation.failed | error.auth.wrong_current_password' })
  @ApiUnauthorizedResponse({ description: 'error.auth.unauthenticated' })
  @ApiForbiddenResponse({ description: 'error.auth.forbidden' })
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: ChangePasswordRequest): Promise<void> {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
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
