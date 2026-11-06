import { DynamicModule, Module } from '@nestjs/common';
import { AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AuditModule } from './shared/audit/audit-writer';
import { DatabaseModule } from './shared/db/database.module';
import { I18nModule } from './shared/i18n/i18n.module';
import { LoggingModule } from './shared/logging/logging.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggingModule,
        DatabaseModule,
        I18nModule,
        AuditModule,
        HealthModule,
        IdentityModule,
        CatalogModule,
      ],
    };
  }
}
