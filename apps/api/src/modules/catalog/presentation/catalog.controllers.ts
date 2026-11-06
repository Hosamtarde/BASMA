import { ParseIdPipe } from '../../../shared/http/parse-id.pipe';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DeleteResponse } from '../../../shared/http/common.dto';
import { ListQuery } from '../../../shared/http/pagination';
import { Permission } from '../../identity/domain/permissions';
import { CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { ExpenseCategoriesService } from '../application/expense-categories.service';
import { TechniciansService } from '../application/technicians.service';
import { WorkTypesService } from '../application/work-types.service';
import type {
  ExpenseCategoryRecord,
  TechnicianRecord,
  WorkTypeRecord,
} from '../infrastructure/catalog.repository';
import {
  CreateExpenseCategoryRequest,
  CreateTechnicianRequest,
  CreateWorkTypeRequest,
  ExpenseCategoryPage,
  ExpenseCategoryResponse,
  TechnicianPage,
  TechnicianResponse,
  UpdateExpenseCategoryRequest,
  UpdateTechnicianRequest,
  UpdateWorkTypeRequest,
  WorkTypePage,
  WorkTypeResponse,
} from './dto';

const toTechnician = (r: TechnicianRecord): TechnicianResponse => ({
  id: r.id,
  name: r.name,
  active: r.active,
  rowVersion: r.rowVersion,
});

const toWorkType = (r: WorkTypeRecord): WorkTypeResponse => ({
  id: r.id,
  name: r.name,
  unitPrice: r.unitPrice,
  sortOrder: r.sortOrder,
  active: r.active,
  rowVersion: r.rowVersion,
});

const toCategory = (r: ExpenseCategoryRecord): ExpenseCategoryResponse => ({
  id: r.id,
  name: r.name,
  isDoctor: r.isDoctor,
  active: r.active,
  rowVersion: r.rowVersion,
});

@ApiTags('technicians')
@ApiBearerAuth()
@Controller('technicians')
export class TechniciansController {
  constructor(private readonly service: TechniciansService) {}

  @Get()
  @RequirePermission(Permission.CatalogRead)
  @ApiOkResponse({ type: TechnicianPage })
  async list(@Query() q: ListQuery): Promise<TechnicianPage> {
    const page = await this.service.list(q);
    return { ...page, items: page.items.map(toTechnician) };
  }

  @Post()
  @RequirePermission(Permission.CatalogWrite)
  @ApiCreatedResponse({ type: TechnicianResponse })
  @ApiConflictResponse({ description: 'error.technician.name_taken' })
  async create(
    @Body() body: CreateTechnicianRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<TechnicianResponse> {
    return toTechnician(await this.service.create(body.name, user.id));
  }

  @Patch(':id')
  @RequirePermission(Permission.CatalogWrite)
  @ApiOkResponse({ type: TechnicianResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  @ApiConflictResponse({ description: 'error.concurrency.stale | error.technician.name_taken' })
  async update(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: UpdateTechnicianRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<TechnicianResponse> {
    const { rowVersion, ...patch } = body;
    return toTechnician(await this.service.update(id, rowVersion, patch, user.id));
  }

  @Delete(':id')
  @RequirePermission(Permission.CatalogWrite)
  @ApiOkResponse({ type: DeleteResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async remove(@Param('id', ParseIdPipe) id: number, @CurrentUser() user: AuthUser): Promise<DeleteResponse> {
    return { outcome: await this.service.remove(id, user.id) };
  }
}

@ApiTags('work-types')
@ApiBearerAuth()
@Controller('work-types')
export class WorkTypesController {
  constructor(private readonly service: WorkTypesService) {}

  @Get()
  @RequirePermission(Permission.CatalogRead)
  @ApiOkResponse({ type: WorkTypePage })
  async list(@Query() q: ListQuery): Promise<WorkTypePage> {
    const page = await this.service.list(q);
    return { ...page, items: page.items.map(toWorkType) };
  }

  @Post()
  @RequirePermission(Permission.CatalogWrite)
  @ApiCreatedResponse({ type: WorkTypeResponse })
  @ApiConflictResponse({ description: 'error.work_type.name_taken' })
  async create(
    @Body() body: CreateWorkTypeRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<WorkTypeResponse> {
    return toWorkType(
      await this.service.create(
        { name: body.name, unitPrice: body.unitPrice, sortOrder: body.sortOrder },
        user.id,
      ),
    );
  }

  @Patch(':id')
  @RequirePermission(Permission.CatalogWrite)
  @ApiOkResponse({ type: WorkTypeResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  @ApiConflictResponse({ description: 'error.concurrency.stale | error.work_type.name_taken' })
  async update(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: UpdateWorkTypeRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<WorkTypeResponse> {
    const { rowVersion, ...patch } = body;
    return toWorkType(await this.service.update(id, rowVersion, patch, user.id));
  }

  @Delete(':id')
  @RequirePermission(Permission.CatalogWrite)
  @ApiOkResponse({ type: DeleteResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async remove(@Param('id', ParseIdPipe) id: number, @CurrentUser() user: AuthUser): Promise<DeleteResponse> {
    return { outcome: await this.service.remove(id, user.id) };
  }
}

@ApiTags('expense-categories')
@ApiBearerAuth()
@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  @Get()
  @RequirePermission(Permission.CatalogRead)
  @ApiOkResponse({ type: ExpenseCategoryPage })
  async list(@Query() q: ListQuery): Promise<ExpenseCategoryPage> {
    const page = await this.service.list(q);
    return { ...page, items: page.items.map(toCategory) };
  }

  @Post()
  @RequirePermission(Permission.CatalogWrite)
  @ApiCreatedResponse({ type: ExpenseCategoryResponse })
  @ApiConflictResponse({ description: 'error.expense_category.name_taken' })
  async create(
    @Body() body: CreateExpenseCategoryRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<ExpenseCategoryResponse> {
    return toCategory(await this.service.create(body.name, user.id));
  }

  @Patch(':id')
  @RequirePermission(Permission.CatalogWrite)
  @ApiOkResponse({ type: ExpenseCategoryResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  @ApiConflictResponse({
    description:
      'error.concurrency.stale | error.expense_category.name_taken | error.expense_category.system',
  })
  async update(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: UpdateExpenseCategoryRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<ExpenseCategoryResponse> {
    const { rowVersion, ...patch } = body;
    return toCategory(await this.service.update(id, rowVersion, patch, user.id));
  }

  @Delete(':id')
  @RequirePermission(Permission.CatalogWrite)
  @ApiOkResponse({ type: DeleteResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  @ApiConflictResponse({ description: 'error.expense_category.system' })
  async remove(@Param('id', ParseIdPipe) id: number, @CurrentUser() user: AuthUser): Promise<DeleteResponse> {
    return { outcome: await this.service.remove(id, user.id) };
  }
}
