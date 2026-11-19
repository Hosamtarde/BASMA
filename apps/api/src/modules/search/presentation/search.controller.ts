import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../identity/domain/permissions';
import { CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { SearchService } from '../application/search.service';
import { SearchQuery, SearchResponse } from './dto';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @RequirePermission(Permission.SearchUse)
  @ApiOperation({
    summary: 'Global search: doctors, cases, payments and outgoing payments; a group the caller cannot read is omitted',
  })
  @ApiOkResponse({ type: SearchResponse })
  @ApiBadRequestResponse({ description: 'error.validation.failed (empty or longer than 100 characters)' })
  async search(@Query() q: SearchQuery, @CurrentUser() user: AuthUser): Promise<SearchResponse> {
    const r = await this.service.search(user.permissions, q.q, q.limit);
    const { q: text, ...groups } = r;
    return { q: text, groups };
  }
}
