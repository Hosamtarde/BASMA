import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
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
import { LedgerService } from '../application/ledger.service';
import { PaymentResult, PaymentsService, PaymentView } from '../application/payments.service';
import {
  BreakdownQuery,
  CasePaymentsResponse,
  DebtBreakdownResponse,
  ChangeChequeStatusRequest,
  CreatePaymentRequest,
  DebtsQuery,
  DebtsResponse,
  DoctorBalanceResponse,
  LedgerSummaryResponse,
  PaymentDetailResponse,
  PaymentListQuery,
  PaymentPage,
  PaymentResponse,
  PaymentResultResponse,
  PaymentSummaryQuery,
  PaymentSummaryResponse,
  StatementQuery,
  StatementResponse,
  VoidPaymentRequest,
} from './dto';
import { CashFlowQuery, CashFlowResponse } from './outgoing.dto';

export const toPaymentResponse = (p: PaymentView): PaymentResponse => ({
  id: p.id,
  voucherNo: p.voucher,
  doctor: { id: p.doctorId, name: p.doctorName },
  case: p.caseId === null ? null : { id: p.caseId, caseNo: p.caseNo ?? 0 },
  method: p.method,
  amount: p.amount,
  currencyCode: p.currencyCode,
  paidAt: p.paidAt,
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

const toResult = (r: PaymentResult): PaymentResultResponse => ({
  payment: toPaymentResponse(r.payment),
  doctorBalance: r.doctorBalance,
});

const definedOnly = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const KEY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'A UUID per attempt; a replay returns the original result (200) instead of a duplicate',
};

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post()
  @RequirePermission(Permission.PaymentsWrite)
  @ApiOperation({ summary: 'Register an incoming payment (cash, cheque or transfer)' })
  @ApiHeader(KEY_HEADER)
  @ApiCreatedResponse({ type: PaymentResultResponse })
  @ApiOkResponse({
    type: PaymentResultResponse,
    description: 'Replay of an earlier request with the same key',
  })
  @ApiBadRequestResponse({
    description: 'error.validation.failed | error.idempotency.required | error.payment.*',
  })
  @ApiNotFoundResponse({ description: 'error.not_found (doctor or case)' })
  @ApiConflictResponse({
    description:
      'error.payment.case_doctor_mismatch | case_cancelled | exceeds_case_total | error.cheque.duplicate',
  })
  @ApiUnprocessableEntityResponse({ description: 'error.idempotency.mismatch' })
  async create(
    @Body() body: CreatePaymentRequest,
    @Headers('idempotency-key') keyHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentResultResponse> {
    const key = requireIdempotencyKey(keyHeader);
    const result = await this.service.create(
      definedOnly({
        doctorId: body.doctorId,
        caseId: body.caseId,
        method: body.method,
        amount: body.amount,
        paidAt: body.paidAt,
        notes: body.notes,
        cheque: body.cheque ? { ...body.cheque } : undefined,
      }),
      key,
      user.id,
    );
    markReplay(res, result.replayed);
    return toResult(result);
  }

  @Get()
  @RequirePermission(Permission.PaymentsRead)
  @ApiOperation({ summary: 'Payments, newest first, with totals of the filtered set' })
  @ApiOkResponse({ type: PaymentPage })
  async list(@Query() q: PaymentListQuery): Promise<PaymentPage> {
    const { page, pageSize, ...filter } = q;
    const r = await this.service.list(definedOnly(filter), page, pageSize);
    return { ...r, items: r.items.map(toPaymentResponse) };
  }

  // Declared before ':id' so "summary" is never read as an id.
  @Get('summary')
  @RequirePermission(Permission.PaymentsRead)
  @ApiOperation({ summary: 'Receipts report figures: counted by method, pending cheques, voided, last payment' })
  @ApiOkResponse({ type: PaymentSummaryResponse })
  async summary(@Query() q: PaymentSummaryQuery): Promise<PaymentSummaryResponse> {
    return this.service.receiptsSummary(definedOnly(q));
  }

  @Get(':id')
  @RequirePermission(Permission.PaymentsRead)
  @ApiOkResponse({ type: PaymentDetailResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async get(@Param('id', ParseIdPipe) id: number): Promise<PaymentDetailResponse> {
    const r = await this.service.get(id);
    return {
      ...toPaymentResponse(r.payment),
      chequeHistory: r.history.map((h) => ({
        fromStatus: h.fromStatus as PaymentDetailResponse['chequeHistory'][number]['fromStatus'],
        toStatus: h.toStatus as PaymentDetailResponse['chequeHistory'][number]['toStatus'],
        statusDate: h.statusDate,
        at: h.at.toISOString(),
        note: h.note,
      })),
    };
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.PaymentsVoid)
  @ApiOperation({ summary: 'Cancel a payment with a reason (never deleted); its cheque is frozen' })
  @ApiOkResponse({ type: PaymentResultResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  @ApiConflictResponse({ description: 'error.payment.already_void | error.concurrency.stale' })
  async void(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: VoidPaymentRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentResultResponse> {
    return toResult(await this.service.void(id, body.rowVersion, body.reason, user.id));
  }
}

@ApiTags('cheques')
@ApiBearerAuth()
@Controller('cheques')
export class ChequesController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly cheques: ChequesService,
  ) {}

  @Patch(':id/status')
  @RequirePermission(Permission.ChequesWrite)
  @ApiOperation({ summary: 'Change a cheque status: pending → cleared | returned, cleared → returned' })
  @ApiOkResponse({ type: PaymentResultResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  @ApiConflictResponse({
    description: 'error.cheque.invalid_transition | error.cheque.payment_void | error.concurrency.stale',
  })
  async changeStatus(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: ChangeChequeStatusRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentResultResponse> {
    return toResult(
      await this.cheques.changeStatus(
        id,
        body.rowVersion,
        body.status,
        body.statusDate,
        body.note ?? null,
        user.id,
      ),
    );
  }
}

/** Balances, statement, debts and the Home summary (SPEC §5.11, §7.3). */
@ApiTags('ledger')
@ApiBearerAuth()
@Controller()
export class LedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('doctors/:id/balance')
  @RequirePermission(Permission.LedgerRead)
  @ApiOkResponse({ type: DoctorBalanceResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async balance(@Param('id', ParseIdPipe) id: number): Promise<DoctorBalanceResponse> {
    return this.ledger.balance(id);
  }

  @Get('doctors/:id/debt-breakdown')
  @RequirePermission(Permission.LedgerRead)
  @AlsoRequire(Permission.CasesRead)
  @ApiOperation({
    summary: 'What makes up the balance: unpaid opening balance, open cases, credit, and the tie-out',
  })
  @ApiOkResponse({ type: DebtBreakdownResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async debtBreakdown(
    @Param('id', ParseIdPipe) id: number,
    @Query() q: BreakdownQuery,
  ): Promise<DebtBreakdownResponse> {
    return this.ledger.debtBreakdown(id, q.page, q.pageSize);
  }

  @Get('doctors/:id/statement')
  @RequirePermission(Permission.LedgerRead)
  @ApiOperation({
    summary: 'Account statement: cases, cleared payments and bounced cheques with a running balance',
  })
  @ApiOkResponse({ type: StatementResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async statement(
    @Param('id', ParseIdPipe) id: number,
    @Query() q: StatementQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<StatementResponse> {
    const r = await this.ledger.statement(id, q.from, q.to, q.page, q.pageSize);
    if (user.permissions.includes(Permission.CasesRead)) return r;
    // Patient names need cases.read (production-readiness #19).
    return { ...r, lines: r.lines.map((l) => ({ ...l, patientName: null })) };
  }

  @Get('cases/:id/payments')
  @RequirePermission(Permission.PaymentsRead)
  @ApiOperation({ summary: 'Payments bound to a case with its paid / remaining amounts' })
  @ApiOkResponse({ type: CasePaymentsResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async casePayments(@Param('id', ParseIdPipe) id: number): Promise<CasePaymentsResponse> {
    const r = await this.payments.casePayments(id);
    return { ...r, payments: r.payments.map(toPaymentResponse) };
  }

  @Get('debts')
  @RequirePermission(Permission.LedgerRead)
  @ApiOperation({ summary: 'Doctors with a balance, largest first, with the four summary figures' })
  @ApiOkResponse({ type: DebtsResponse })
  async debts(@Query() q: DebtsQuery): Promise<DebtsResponse> {
    const r = await this.ledger.debts(q.direction, q.search, q.page, q.pageSize);
    return {
      summary: r.summary,
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
      items: r.items.map((i) => ({
        doctor: { id: i.doctorId, name: i.name },
        active: i.active,
        balance: i.balance,
        direction: i.direction,
        pendingCheques: i.pendingCheques,
      })),
    };
  }

  @Get('ledger/cash-flow')
  @RequirePermission(Permission.LedgerRead)
  @AlsoRequire(Permission.ExpensesRead)
  @ApiOperation({
    summary: 'Cash summary for a period (SPEC 10): counted money in and out by effective date, and the net',
  })
  @ApiOkResponse({ type: CashFlowResponse })
  @ApiBadRequestResponse({ description: 'error.ledger.range_invalid (from after to)' })
  async cashFlow(@Query() q: CashFlowQuery): Promise<CashFlowResponse> {
    return this.ledger.cashFlow(q.from, q.to);
  }

  @Get('ledger/summary')
  @RequirePermission(Permission.LedgerRead)
  @ApiOperation({ summary: 'Figures for Home: received this month, owed to the lab, cheques, outgoing money' })
  @ApiOkResponse({ type: LedgerSummaryResponse })
  async summary(@CurrentUser() user: AuthUser): Promise<LedgerSummaryResponse> {
    const s = await this.ledger.summary();
    if (user.permissions.includes(Permission.ExpensesRead)) return s;
    // Outgoing figures need expenses.read (B4b X10).
    return {
      ...s,
      outgoingThisMonth: null,
      outgoingTotal: null,
      outgoingChequesDueSoon: null,
      outgoingChequesOverdue: null,
    };
  }
}
