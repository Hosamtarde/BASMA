import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { markReplay, requireIdempotencyKey } from '../../../shared/http/idempotency';
import { ParseIdPipe } from '../../../shared/http/parse-id.pipe';
import { Permission } from '../../identity/domain/permissions';
import { AlsoRequire, CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { ChequesService } from '../application/cheques.service';
import { OutgoingResult, OutgoingService, OutgoingView } from '../application/outgoing.service';
import { allowedChequeStatuses, dueState, formatVoucher } from '../domain/payment-rules';
import type { RegisterRow } from '../infrastructure/cheque-register.repository';
import { ChangeChequeStatusRequest, VoidPaymentRequest } from './dto';
import {
  ChequeRegisterItem,
  ChequeRegisterPage,
  ChequeRegisterQuery,
  ChequeRegisterSummaryQuery,
  ChequeRegisterSummaryResponse,
  CreateOutgoingPaymentRequest,
  OutgoingDetailResponse,
  OutgoingListQuery,
  OutgoingPage,
  OutgoingPaymentResponse,
  OutgoingResultResponse,
  OutgoingSummaryQuery,
  OutgoingSummaryResponse,
} from './outgoing.dto';

const definedOnly = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export const toOutgoingResponse = (p: OutgoingView): OutgoingPaymentResponse => ({
  id: p.id,
  voucherNo: p.voucher,
  kind: p.kind,
  category: { id: p.categoryId, name: p.categoryName },
  doctor: p.doctorId === null ? null : { id: p.doctorId, name: p.doctorName ?? '' },
  payee: p.payee,
  method: p.method,
  amount: p.amount,
  currencyCode: p.currencyCode,
  paidAt: p.paidAt,
  effectiveDate: p.effectiveDate,
  notes: p.notes,
  status: p.status,
  voidReason: p.voidReason,
  voidedAt: p.voidedAt?.toISOString() ?? null,
  counted: p.counted,
  cheque: p.cheque
    ? {
        id: p.cheque.id,
        chequeNo: p.cheque.chequeNo,
        bank: p.cheque.bank,
        dueDate: p.cheque.dueDate,
        status: p.cheque.status,
        statusDate: p.cheque.statusDate,
        dueState: p.cheque.dueState,
        allowedStatuses: p.cheque.allowedStatuses,
        rowVersion: p.cheque.rowVersion,
      }
    : null,
  rowVersion: p.rowVersion,
  createdAt: p.createdAt.toISOString(),
});

const toResult = (r: OutgoingResult): OutgoingResultResponse => ({
  payment: toOutgoingResponse(r.payment),
  doctorBalance: r.doctorBalance,
});

const KEY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'A UUID per attempt; a replay returns the original result (200) instead of a duplicate',
};

/** «إنشاء دفعة صادرة» (SPEC §5.9, B4b): expenses and refunds to doctors. */
@ApiTags('outgoing')
@ApiBearerAuth()
@Controller('outgoing-payments')
export class OutgoingPaymentsController {
  constructor(private readonly service: OutgoingService) {}

  @Post()
  @RequirePermission(Permission.ExpensesWrite)
  @ApiOperation({
    summary: 'Record an outgoing payment: an expense (payee) or, with the doctor-refund category, a refund',
    description: 'A refund also needs ledger.read and may not exceed the doctor refundable credit.',
  })
  @ApiHeader(KEY_HEADER)
  @ApiCreatedResponse({ type: OutgoingResultResponse })
  @ApiOkResponse({ type: OutgoingResultResponse, description: 'Replay of an earlier request with the same key' })
  @ApiBadRequestResponse({
    description: 'error.validation.failed | error.idempotency.required | error.outgoing.* | error.payment.*',
  })
  @ApiNotFoundResponse({ description: 'error.not_found (category or doctor)' })
  @ApiConflictResponse({
    description: 'error.outgoing.category_inactive | refund_exceeds_credit | error.cheque.duplicate',
  })
  @ApiUnprocessableEntityResponse({ description: 'error.idempotency.mismatch' })
  async create(
    @Body() body: CreateOutgoingPaymentRequest,
    @Headers('idempotency-key') keyHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OutgoingResultResponse> {
    const key = requireIdempotencyKey(keyHeader);
    const result = await this.service.create(
      definedOnly({
        categoryId: body.categoryId,
        payee: body.payee,
        doctorId: body.doctorId,
        method: body.method,
        amount: body.amount,
        paidAt: body.paidAt,
        notes: body.notes,
        cheque: body.cheque ? { ...body.cheque } : undefined,
      }),
      key,
      user.id,
      // A refund shows and moves a doctor's balance: it needs ledger.read too (B4b X10).
      () => user.permissions.includes(Permission.LedgerRead),
    );
    markReplay(res, result.replayed);
    return toResult(result);
  }

  @Get()
  @RequirePermission(Permission.ExpensesRead)
  @ApiOperation({ summary: 'Outgoing payments (the expenses report table), newest first, with totals' })
  @ApiOkResponse({ type: OutgoingPage })
  async list(@Query() q: OutgoingListQuery): Promise<OutgoingPage> {
    const { page, pageSize, ...filter } = q;
    const r = await this.service.list(definedOnly(filter), page, pageSize);
    return { ...r, items: r.items.map(toOutgoingResponse) };
  }

  // Declared before ':id' so "summary" is never read as an id.
  @Get('summary')
  @RequirePermission(Permission.ExpensesRead)
  @ApiOperation({
    summary: 'Expenses report figures: counted by category and method (effective date), refunds, pending, voided',
  })
  @ApiOkResponse({ type: OutgoingSummaryResponse })
  async summary(@Query() q: OutgoingSummaryQuery): Promise<OutgoingSummaryResponse> {
    return this.service.summary(definedOnly({ ...q }));
  }

  @Get(':id')
  @RequirePermission(Permission.ExpensesRead)
  @ApiOkResponse({ type: OutgoingDetailResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async get(@Param('id', ParseIdPipe) id: number): Promise<OutgoingDetailResponse> {
    const r = await this.service.get(id);
    return {
      ...toOutgoingResponse(r.payment),
      chequeHistory: r.history.map((h) => ({
        fromStatus: h.fromStatus as OutgoingDetailResponse['chequeHistory'][number]['fromStatus'],
        toStatus: h.toStatus as OutgoingDetailResponse['chequeHistory'][number]['toStatus'],
        statusDate: h.statusDate,
        at: h.at.toISOString(),
        note: h.note,
      })),
    };
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ExpensesVoid)
  @ApiOperation({ summary: 'Cancel an outgoing payment with a reason (never deleted); its cheque is frozen' })
  @ApiOkResponse({ type: OutgoingResultResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  @ApiConflictResponse({ description: 'error.outgoing.already_void | error.concurrency.stale' })
  async void(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: VoidPaymentRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<OutgoingResultResponse> {
    return toResult(await this.service.void(id, body.rowVersion, body.reason, user.id));
  }
}

/** Status of the lab's own cheques (B4b): same rules as incoming ones (SPEC §5.13, D3). */
@ApiTags('cheques')
@ApiBearerAuth()
@Controller('outgoing-cheques')
export class OutgoingChequesController {
  constructor(private readonly cheques: ChequesService) {}

  @Patch(':id/status')
  @RequirePermission(Permission.ChequesWrite)
  @AlsoRequire(Permission.ExpensesWrite)
  @ApiOperation({ summary: 'Change an outgoing cheque status: pending → cleared | returned, cleared → returned' })
  @ApiOkResponse({ type: OutgoingResultResponse })
  @ApiNotFoundResponse({ description: 'error.not_found (also for an incoming cheque id)' })
  @ApiConflictResponse({
    description: 'error.cheque.invalid_transition | error.cheque.payment_void | error.concurrency.stale',
  })
  async changeStatus(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: ChangeChequeStatusRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<OutgoingResultResponse> {
    return toResult(
      await this.cheques.changeOutgoingStatus(id, body.rowVersion, body.status, body.statusDate, body.note ?? null, user.id),
    );
  }
}

const toRegisterItem = (r: RegisterRow, today: string, soonUntil: string): ChequeRegisterItem => ({
  direction: r.direction,
  cheque: {
    id: r.chequeId,
    chequeNo: r.chequeNo,
    bank: r.bank,
    dueDate: r.dueDate,
    status: r.status,
    statusDate: r.statusDate,
    dueState: dueState({ status: r.status, dueDate: r.dueDate, paymentVoid: false }, today, soonUntil),
    allowedStatuses: allowedChequeStatuses(r.status, false),
    rowVersion: r.rowVersion,
  },
  payment: { id: r.paymentId, voucherNo: formatVoucher(r.voucherNo, r.direction), amount: r.amount, paidAt: r.paidAt },
  party: {
    kind: r.direction === 'out' && r.doctorId === null ? 'payee' : 'doctor',
    name: r.partyName,
    doctorId: r.doctorId,
  },
  category: r.categoryId === null ? null : { id: r.categoryId, name: r.categoryName ?? '' },
});

/** The cheque register over both directions (SPEC §5.13 «واردة / صادرة», B4b). */
@ApiTags('cheques')
@ApiBearerAuth()
@Controller('cheques/register')
export class ChequeRegisterController {
  constructor(private readonly cheques: ChequesService) {}

  @Get()
  @RequirePermission(Permission.ChequesRead)
  @ApiOperation({
    summary: 'Incoming and outgoing cheques of active payments, by due date',
    description: 'Outgoing cheques are listed only for callers with expenses.read.',
  })
  @ApiOkResponse({ type: ChequeRegisterPage })
  async list(@Query() q: ChequeRegisterQuery, @CurrentUser() user: AuthUser): Promise<ChequeRegisterPage> {
    const { page, pageSize, ...filter } = q;
    const r = await this.cheques.register(
      definedOnly(filter),
      user.permissions.includes(Permission.ExpensesRead),
      page,
      pageSize,
    );
    const soon = 'soonUntil' in r ? r.soonUntil : r.today;
    return {
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
      items: r.items.map((i) => toRegisterItem(i, r.today, soon)),
    };
  }

  @Get('summary')
  @RequirePermission(Permission.ChequesRead)
  @ApiOperation({ summary: 'Chip counts per status and direction, due soon, overdue, pending amounts' })
  @ApiOkResponse({ type: ChequeRegisterSummaryResponse })
  async summary(
    @Query() q: ChequeRegisterSummaryQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<ChequeRegisterSummaryResponse> {
    return this.cheques.registerSummary(definedOnly({ ...q }), user.permissions.includes(Permission.ExpensesRead));
  }
}
