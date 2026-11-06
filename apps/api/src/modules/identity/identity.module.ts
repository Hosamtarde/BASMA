import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfig } from '../../config/app-config';
import { CatalogModule } from '../catalog/catalog.module';
import { SettingsModule } from '../settings/settings.module';
import { APP_CONFIG } from '../../config/config.module';
import { AuthService } from './application/auth.service';
import { PasswordHasher } from './application/password-hasher';
import { SetupService } from './application/setup.service';
import { TokenService } from './application/token.service';
import { IdentityRepository } from './infrastructure/identity.repository';
import { AuthController } from './presentation/auth.controller';
import { AuthGuard } from './presentation/auth.guard';
import { SetupController } from './presentation/setup.controller';

@Module({
  imports: [
    // First-run setup writes the initial settings and expense categories.
    SettingsModule,
    CatalogModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwt.accessSecret,
        signOptions: { algorithm: 'HS256', expiresIn: config.jwt.accessTtlSeconds },
      }),
    }),
    // Applied only to setup/auth routes (password guessing, setup takeover).
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: 60_000, limit: config.authRateLimitPerMinute }],
    }),
  ],
  controllers: [SetupController, AuthController],
  providers: [
    AuthService,
    SetupService,
    TokenService,
    PasswordHasher,
    IdentityRepository,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class IdentityModule {}
