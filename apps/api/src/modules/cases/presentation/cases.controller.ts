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
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Headers, Res } from '@nestjs/common';
import type { Response } from 'express';
import { markReplay, requireIdempotencyKey } from '../../../shared/http/idempotency';
import { DomainError } from '../../../shared/errors/domain-error';
import { toPaymentResponse } from '../../payments/presentation/payments.controller';
import { ParseIdPipe } from '../../../shared/http/parse-id.pipe';
import { Permission } from '../../identity/domain/permissions';
import { CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { CaseDetail, CasesService, CaseSummary } from '../application/cases.service';
import { caseActions } from '../domain/case-rules';
import {
  AddCaseLinesRequest,
  CancelCaseRequest,
  CaseCountsResponse,
  CaseDetailResponse,
  CaseFilterQueryDto,
  CaseListQueryDto,
  CaseSummaryPage,
  CaseSummaryResponse,
  ChangeCaseStatusRequest,
  CreateCaseRequest,
  CreateCaseResponse,
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
  paid: c.paid,
  remaining: c.remaining,
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

  // Declared before ':id' so "summary" is never read as an id.
  @Get('summary')
  @RequirePermission(Permission.CasesRead)
  @ApiOperation({
    summary: 'Cases per status and overdue, in one snapshot; same filters as the list except status',
  })
  @ApiOkResponse({ type: CaseCountsResponse })
  async summary(@Query() q: CaseFilterQueryDto): Promise<CaseCountsResponse> {
    return this.service.counts(definedOnly({ ...q }));
  }

  @Post()
  @RequirePermission(Permission.CasesWrite)
  @ApiOperation({
    summary:
      'Create a case; numbers and prices are assigned by the server. An advance payment is created in the same transaction',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Required when "advance" is sent (a UUID per attempt); a replay returns the original case (200)',
  })
  @ApiCreatedResponse({ type: CreateCaseResponse })
  @ApiOkResponse({ type: CreateCaseResponse, description: 'Replay of an advance request with the same key' })
  @ApiBadRequestResponse({
    description:
      'error.validation.failed | error.case.* (dates, line position) | error.idempotency.required | error.payment.*',
  })
  @ApiConflictResponse({
    description:
      'error.case.*_inactive | error.case.discount_exceeds_subtotal | error.payment.exceeds_case_total',
  })
  async create(
    @Body() body: CreateCaseRequest,
    @Headers('idempotency-key') keyHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateCaseResponse> {
    const { advance, ...caseBody } = body;
    let advanceArg: Parameters<CasesService['create']>[2];
    if (advance) {
      // The advance is a payment: it needs its own permission and a key (duplicates hurt, ADR-0010).
      if (!user.permissions.includes(Permission.PaymentsWrite)) {
        throw new DomainError('error.auth.forbidden', HttpStatus.FORBIDDEN);
      }
      advanceArg = {
        key: requireIdempotencyKey(keyHeader),
        payment: definedOnly({
          method: advance.method,
          amount: advance.amount,
          paidAt: advance.paidAt,
          notes: advance.notes,
          cheque: advance.cheque ? { ...advance.cheque } : undefined,
        }),
      };
    }
    const created = await this.service.create(
      definedOnly({
        doctorId: caseBody.doctorId,
        patientName: caseBody.patientName,
        technicianId: caseBody.technicianId,
        receivedDate: caseBody.receivedDate,
        expectedDate: caseBody.expectedDate,
        status: caseBody.status,
        discount: caseBody.discount,
        notes: caseBody.notes,
        lines: caseBody.lines.map((l) => definedOnly({ ...l })),
      }),
      user.id,
      advanceArg,
    );
    markReplay(res, created.replayed);
    return {
      ...toDetail(created.detail),
      advancePayment: created.advance ? toPaymentResponse(created.advance) : null,
    };
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
