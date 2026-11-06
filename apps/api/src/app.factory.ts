import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule, AppOptions } from './app.module';
import { AppConfig } from './config/app-config';
import { PRODUCT_NAME } from './config/product';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';
import { createValidationPipe } from './shared/errors/validation';
import { I18nService } from './shared/i18n/i18n.service';

export const API_PREFIX = 'api/v1';

/** Builds the fully configured app; shared by main.ts and the e2e tests so both run the same pipeline. */
export async function createApp(config: AppConfig, options: AppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config, options), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter(app.get(I18nService)));
  app.enableShutdownHooks();

  if (!config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle(`${PRODUCT_NAME} API`).setVersion('1').addBearerAuth().build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }
  return app;
}
