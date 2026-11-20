import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { I18nService } from '../../../shared/i18n/i18n.service';
import { Permission } from '../../identity/domain/permissions';
import { CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { NotificationsService } from '../application/notifications.service';
import {
  NotificationCountResponse,
  NotificationsQuery,
  NotificationsResponse,
  NotificationStateRequest,
} from './dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  @RequirePermission(Permission.NotificationsRead)
  @ApiOperation({
    summary:
      'The notifications feed (SPEC §5.16): cases due or overdue, incoming and outgoing cheques due, collect dates reached. A type the caller cannot read is left out',
  })
  @ApiOkResponse({ type: NotificationsResponse })
  async feed(
    @Query() q: NotificationsQuery,
    @CurrentUser() user: AuthUser,
    @Headers('accept-language') acceptLanguage: string | undefined,
  ): Promise<NotificationsResponse> {
    return this.service.feed(user, this.i18n.resolveLanguage(acceptLanguage), q.limit);
  }

  // Declared before any ':param' route; polled by the bell.
  @Get('count')
  @RequirePermission(Permission.NotificationsRead)
  @ApiOperation({ summary: 'Unread and total items of the feed (the bell badge)' })
  @ApiOkResponse({ type: NotificationCountResponse })
  async count(@CurrentUser() user: AuthUser): Promise<NotificationCountResponse> {
    return this.service.count(user);
  }

  @Patch('state')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.NotificationsRead)
  @ApiOperation({
    summary: 'Mark items read, hide them or show them again (per user); keys not in the caller’s feed now are ignored',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'error.validation.failed' })
  async state(@Body() body: NotificationStateRequest, @CurrentUser() user: AuthUser): Promise<void> {
    await this.service.mark(user, body.keys, {
      ...(body.seen ? { seen: true as const } : {}),
      ...(body.dismissed === undefined ? {} : { dismissed: body.dismissed }),
    });
  }
}
