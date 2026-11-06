import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Pool } from 'pg';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/config.module';
import { Public } from '../identity/presentation/auth.decorators';
import { PG_POOL } from '../../shared/db/database';
import { getMigrationStatus } from '../../shared/db/migrator';
import { DomainError } from '../../shared/errors/domain-error';

class LiveResponse {
  @ApiProperty({ example: 'ok' }) status!: 'ok';
}

class ReadyResponse {
  @ApiProperty({ example: 'ok' }) status!: 'ok';
  @ApiProperty({ example: 'up' }) database!: 'up';
  @ApiProperty({ example: 'current' }) migrations!: 'current';
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Process is running' })
  @ApiOkResponse({ type: LiveResponse })
  live(): LiveResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Database reachable and all migrations applied' })
  @ApiOkResponse({ type: ReadyResponse })
  @ApiServiceUnavailableResponse({ description: 'error.health.not_ready' })
  async ready(): Promise<ReadyResponse> {
    let database: 'up' | 'down' = 'down';
    let migrations: 'current' | 'pending' | 'unknown' = 'unknown';
    try {
      await this.pool.query('SELECT 1');
      database = 'up';
      const status = await getMigrationStatus(this.pool, this.config.migrationsDir);
      migrations = status.current ? 'current' : 'pending';
    } catch {
      // Reported through the 503 below; details stay out of the response.
    }
    if (database !== 'up' || migrations !== 'current') {
      throw new DomainError('error.health.not_ready', HttpStatus.SERVICE_UNAVAILABLE, {
        database,
        migrations,
      });
    }
    return { status: 'ok', database, migrations };
  }
}
