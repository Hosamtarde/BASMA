import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../identity/domain/permissions';
import { RequirePermission } from '../../identity/presentation/auth.decorators';
import { AuditFeedService } from '../application/audit-feed.service';
import { AuditRecentQuery, AuditRecentResponse } from './dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditFeedController {
  constructor(private readonly service: AuditFeedService) {}

  // The audit log is a system view: it needs settings.read (there is no separate audit permission, and a
  // new one would need a migration).
  @Get('recent')
  @RequirePermission(Permission.SettingsRead)
  @ApiOperation({
    summary:
      'The latest 20 audit entries for «آخر العمليات»: action code, entity type and label, user name and time. Never payloads, reasons, amounts or addresses',
  })
  @ApiOkResponse({ type: AuditRecentResponse })
  @ApiBadRequestResponse({ description: 'error.validation.failed (the route takes no parameters)' })
  async recent(@Query() _q: AuditRecentQuery): Promise<AuditRecentResponse> {
    return { items: await this.service.recent() };
  }
}
