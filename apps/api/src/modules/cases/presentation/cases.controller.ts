import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ParseIdPipe } from '../../../shared/http/parse-id.pipe';
import { Permission } from '../../identity/domain/permissions';
import { CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { CaseDetail, CasesService, CaseSummary } from '../application/cases.service';
import { caseActions } from '../domain/case-rules';
import {
  AddCaseLinesRequest,
  CancelCaseRequest,
  CaseDetailResponse,
  CaseListQueryDto,
  CaseSummaryPage,
  CaseSummaryResponse,
  ChangeCaseStatusRequest,
  CreateCaseRequest,
  UpdateCaseLineRequest,
  UpdateCaseRequest,
} from './dto';

const toSummary = (c: CaseSummary): CaseSummaryResponse => ({
  id: c.id,
  caseNo: c.caseNo,
  doctor: { id: c.doctorId, name: c.doctorName },
  patientName: c.patientName,
  technician: c.technicianId === null ? null : { id: c.technicianId, name: c.technicianName ?? '' },
  receivedDate: c.receivedDate,
  expectedDate: c.expectedDate,
  deliveredDate: c.deliveredDate,
  status: c.status,
  total: c.total,
  overdue: c.overdue,
  rowVersion: c.rowVersion,
});

const toDetail = (c: CaseDetail): CaseDetailResponse => ({
  ...toSummary(c),
  subtotal: c.subtotal,
  discount: c.discount,
  notes: c.notes,
  lines: c.items.map((i) => ({
    id: i.id,
    toothNo: i.toothNo,
    area: i.area,
    workTypeId: i.workTypeId,
    workTypeName: i.workTypeName,
    shade: i.shade,
    unitPrice: i.unitPrice,
    priceSource: i.priceSource,
    note: i.note,
  })),
  history: c.history.map((h) => ({
    fromStatus: h.fromStatus,
    toStatus: h.toStatus,
    at: h.at.toISOString(),
    note: h.note,
    deliveredDate: h.deliveredDate,
  })),
  ...caseActions(c.status),
});

const definedOnly = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
export class CasesController {
  constructor(private readonly service: CasesService) {}

  @Get()
  @RequirePermission(Permission.CasesRead)
  @ApiOperation({
    summary: 'Cases, newest first; filters: status, doctor, overdue, received date range, search',
  })
  @ApiOkResponse({ type: CaseSummaryPage })
  async list(@Query() q: CaseListQueryDto): Promise<CaseSummaryPage> {
    const page = await this.service.list(definedOnly(q));
    return { ...page, items: page.items.map(toSummary) };
  }

  @Post()
  @RequirePermission(Permission.CasesWrite)
  @ApiOperation({ summary: 'Create a case; numbers and prices are assigned by the server' })
  @ApiCreatedResponse({ type: CaseDetailResponse })
  @ApiBadRequestResponse({ description: 'error.validation.failed | error.case.* (dates, line position)' })
  @ApiConflictResponse({ description: 'error.case.*_inactive | error.case.discount_exceeds_subtotal' })
  async create(@Body() body: CreateCaseRequest, @CurrentUser() user: AuthUser): Promise<CaseDetailResponse> {
    return toDetail(
      await this.service.create(
        definedOnly({
          doctorId: body.doctorId,
          patientName: body.patientName,
          technicianId: body.technicianId,
          receivedDate: body.receivedDate,
          expectedDate: body.expectedDate,
          status: body.status,
          discount: body.discount,
          notes: body.notes,
          lines: body.lines.map((l) => definedOnly({ ...l })),
        }),
        user.id,
      ),
    );
  }

  @Get(':id')
  @RequirePermission(Permission.CasesRead)
  @ApiOkResponse({ type: CaseDetailResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async get(@Param('id', ParseIdPipe) id: number): Promise<CaseDetailResponse> {
    return toDetail(await this.service.get(id));
  }

  @Patch(':id')
  @RequirePermission(Permission.CasesWrite)
  @ApiOperation({ summary: 'Edit the case header (the doctor cannot change)' })
  @ApiOkResponse({ type: CaseDetailResponse })
  @ApiConflictResponse({ description: 'error.concurrency.stale | error.case.cancelled' })
  async update(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: UpdateCaseRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<CaseDetailResponse> {
    const { rowVersion, ...patch } = body;
    return toDetail(await this.service.update(id, rowVersion, definedOnly(patch), user.id));
  }

  @Post(':id/lines')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.CasesWrite)
  @ApiOkResponse({ type: CaseDetailResponse })
  @ApiConflictResponse({ description: 'error.case.too_many_lines | error.concurrency.stale' })
  async addLines(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: AddCaseLinesRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<CaseDetailResponse> {
    return toDetail(
      await this.service.addLines(
        id,
        body.rowVersion,
        body.lines.map((l) => definedOnly({ ...l })),
        user.id,
      ),
    );
  }

  @Patch(':id/lines/:lineId')
  @RequirePermission(Permission.CasesWrite)
  @ApiOkResponse({ type: CaseDetailResponse })
  async updateLine(
    @Param('id', ParseIdPipe) id: number,
    @Param('lineId', ParseIdPipe) lineId: number,
    @Body() body: UpdateCaseLineRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<CaseDetailResponse> {
    const { rowVersion, ...patch } = body;
    return toDetail(await this.service.updateLine(id, lineId, rowVersion, definedOnly(patch), user.id));
  }

  @Delete(':id/lines/:lineId')
  @RequirePermission(Permission.CasesWrite)
  @ApiQuery({ name: 'rowVersion', type: Number, required: true })
  @ApiOkResponse({ type: CaseDetailResponse })
  @ApiConflictResponse({ description: 'error.case.last_line | error.case.discount_exceeds_subtotal' })
  async removeLine(
    @Param('id', ParseIdPipe) id: number,
    @Param('lineId', ParseIdPipe) lineId: number,
    @Query('rowVersion', ParseIdPipe) rowVersion: number,
    @CurrentUser() user: AuthUser,
  ): Promise<CaseDetailResponse> {
    return toDetail(await this.service.removeLine(id, lineId, rowVersion, user.id));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.CasesWrite)
  @ApiOperation({ summary: 'Change status (machine of SPEC §9 as approved for B2)' })
  @ApiOkResponse({ type: CaseDetailResponse })
  @ApiConflictResponse({ description: 'error.case.invalid_transition | error.case.same_status' })
  async changeStatus(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: ChangeCaseStatusRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<CaseDetailResponse> {
    return toDetail(
      await this.service.changeStatus(
        id,
        body.rowVersion,
        body.to,
        body.note ?? null,
        body.deliveredDate,
        user.id,
      ),
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.CasesCancel)
  @ApiOperation({ summary: 'Cancel (final). Only before delivery.' })
  @ApiOkResponse({ type: CaseDetailResponse })
  @ApiConflictResponse({ description: 'error.case.cannot_cancel | error.case.cancelled' })
  async cancel(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: CancelCaseRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<CaseDetailResponse> {
    return toDetail(await this.service.cancel(id, body.rowVersion, body.reason ?? null, user.id));
  }
}
