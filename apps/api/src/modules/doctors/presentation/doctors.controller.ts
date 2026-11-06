import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DeleteResponse } from '../../../shared/http/common.dto';
import { ListQuery } from '../../../shared/http/pagination';
import { Permission } from '../../identity/domain/permissions';
import { CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { DoctorsService } from '../application/doctors.service';
import type { DoctorPriceRow, DoctorRecord } from '../infrastructure/doctors.repository';
import {
  CreateDoctorRequest,
  DoctorPage,
  DoctorPriceResponse,
  DoctorResponse,
  SetDoctorPriceRequest,
  UpdateDoctorRequest,
} from './dto';

const toDoctor = (r: DoctorRecord): DoctorResponse => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  clinic: r.clinic,
  notes: r.notes,
  openingBalance: r.openingBalance,
  active: r.active,
  rowVersion: r.rowVersion,
});

const toPrice = (r: DoctorPriceRow): DoctorPriceResponse => ({
  workTypeId: r.workTypeId,
  workTypeName: r.workTypeName,
  workTypeActive: r.workTypeActive,
  generalPrice: r.generalPrice,
  specialPrice: r.specialPrice,
});

@ApiTags('doctors')
@ApiBearerAuth()
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly service: DoctorsService) {}

  @Get()
  @RequirePermission(Permission.DoctorsRead)
  @ApiOperation({ summary: 'List doctors; search matches name, phone or clinic' })
  @ApiOkResponse({ type: DoctorPage })
  async list(@Query() q: ListQuery): Promise<DoctorPage> {
    const page = await this.service.list(q);
    return { ...page, items: page.items.map(toDoctor) };
  }

  @Post()
  @RequirePermission(Permission.DoctorsWrite)
  @ApiCreatedResponse({ type: DoctorResponse })
  @ApiConflictResponse({ description: 'error.doctor.name_taken' })
  async create(@Body() body: CreateDoctorRequest, @CurrentUser() user: AuthUser): Promise<DoctorResponse> {
    return toDoctor(
      await this.service.create(
        {
          name: body.name,
          phone: body.phone ?? null,
          clinic: body.clinic ?? null,
          notes: body.notes ?? null,
          openingBalance: body.openingBalance,
        },
        user.id,
      ),
    );
  }

  @Get(':id')
  @RequirePermission(Permission.DoctorsRead)
  @ApiOkResponse({ type: DoctorResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async get(@Param('id', ParseIntPipe) id: number): Promise<DoctorResponse> {
    return toDoctor(await this.service.get(id));
  }

  @Patch(':id')
  @RequirePermission(Permission.DoctorsWrite)
  @ApiOkResponse({ type: DoctorResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  @ApiConflictResponse({ description: 'error.concurrency.stale | error.doctor.name_taken' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateDoctorRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<DoctorResponse> {
    const { rowVersion, ...patch } = body;
    return toDoctor(await this.service.update(id, rowVersion, patch, user.id));
  }

  @Delete(':id')
  @RequirePermission(Permission.DoctorsWrite)
  @ApiOperation({ summary: 'Delete if never used and opening balance is 0; otherwise deactivate' })
  @ApiOkResponse({ type: DeleteResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ): Promise<DeleteResponse> {
    return { outcome: await this.service.remove(id, user.id) };
  }

  @Get(':id/prices')
  @RequirePermission(Permission.DoctorsRead)
  @ApiOperation({ summary: 'Work types with general and special price for this doctor' })
  @ApiOkResponse({ type: [DoctorPriceResponse] })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async prices(@Param('id', ParseIntPipe) id: number): Promise<DoctorPriceResponse[]> {
    return (await this.service.listPrices(id)).map(toPrice);
  }

  @Put(':id/prices/:workTypeId')
  @RequirePermission(Permission.DoctorsWrite)
  @ApiOkResponse({ type: DoctorPriceResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async setPrice(
    @Param('id', ParseIntPipe) id: number,
    @Param('workTypeId', ParseIntPipe) workTypeId: number,
    @Body() body: SetDoctorPriceRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<DoctorPriceResponse> {
    return toPrice(await this.service.setPrice(id, workTypeId, body.price, user.id));
  }

  @Delete(':id/prices/:workTypeId')
  @RequirePermission(Permission.DoctorsWrite)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the special price (general price applies again)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async removePrice(
    @Param('id', ParseIntPipe) id: number,
    @Param('workTypeId', ParseIntPipe) workTypeId: number,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.service.removePrice(id, workTypeId, user.id);
  }
}
