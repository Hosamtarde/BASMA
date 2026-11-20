import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsOptionalNonNull, PageMeta, VersionedPatch } from '../../../shared/http/common.dto';
import { IsDateOnly } from '../../../shared/http/date-fields';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../shared/http/pagination';
import { OptionalText } from '../../../shared/http/text-fields';
import { MAX_AMOUNT_MINOR } from '../../../shared/money/limits';
import { IsName, normalizeName } from '../../../shared/text/names';
import type {
  BalanceDirection,
  ChequeStatus,
  DueState,
  PaymentMethod,
  PaymentStatus,
} from '../domain/payment-rules';
import { CHEQUE_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '../domain/payment-rules';
import { STATEMENT_KINDS } from '../infrastructure/ledger.repository';
import type { StatementKind } from '../infrastructure/ledger.repository';

const amountDoc = { description: 'Integer minor units', minimum: 0 };
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

// ---- Requests ----

export class ChequeInput {
  @ApiProperty({ maxLength: 30 }) @IsName(30) chequeNo!: string;
  @ApiProperty({ maxLength: 60 }) @IsName(60) bank!: string;
  @ApiProperty({ example: '2026-12-01' }) @IsDateOnly() dueDate!: string;
}

/** The fields of a payment that do not name its doctor/case (shared with the case advance). */
export class AdvancePaymentInput {
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method!: PaymentMethod;
  @ApiProperty({ description: 'Integer minor units, at least 1', minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_MINOR)
  amount!: number;
  @ApiPropertyOptional({ description: 'Default: today (lab time zone); never in the future' })
  @IsOptionalNonNull()
  @IsDateOnly()
  paidAt?: string;
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true }) @OptionalText(500) notes?:
    string | null;
  @ApiPropertyOptional({ type: ChequeInput, description: 'Required for method=cheque, forbidden otherwise' })
  @IsOptionalNonNull()
  @ValidateNested()
  @Type(() => ChequeInput)
  cheque?: ChequeInput;
}

export class CreatePaymentRequest extends AdvancePaymentInput {
  @ApiProperty() @IsInt() @Min(1) doctorId!: number;
  @ApiPropertyOptional({ type: 'integer', nullable: true, description: 'Bind to a case of this doctor' })
  @IsOptional()
  @IsInt()
  @Min(1)
  caseId?: number | null;
}

export class VoidPaymentRequest extends VersionedPatch {
  @ApiProperty({ maxLength: 300 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeName(value) : value))
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason!: string;
}

export class ChangeChequeStatusRequest extends VersionedPatch {
  @ApiProperty({ enum: CHEQUE_STATUSES }) @IsIn(CHEQUE_STATUSES) status!: ChequeStatus;
  @ApiPropertyOptional({ description: 'Default today; between the payment date and today, not before the current status date' })
  @IsOptionalNonNull()
  @IsDateOnly()
  statusDate?: string;
  @ApiPropertyOptional({ type: String, maxLength: 300, nullable: true }) @OptionalText(300) note?:
    string | null;
}

class PagingQuery {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;
}

export class PaymentListQuery extends PagingQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) doctorId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) caseId?: number;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethod;
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: PaymentStatus;
  @ApiPropertyOptional({ description: 'true: only payments that count now; false: only those that do not' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  counted?: boolean;
  @ApiPropertyOptional({ description: 'Payment date from (inclusive)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;
  @ApiPropertyOptional({ description: 'Payment date to (inclusive)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;
  @ApiPropertyOptional({ description: 'Voucher number, doctor name or cheque number', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/** Filters of the receipts summary: the payments list without paging, status and counted. */
export class PaymentSummaryQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) doctorId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) caseId?: number;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethod;
  @ApiPropertyOptional({ description: 'First day (inclusive); counted money by its effective date' })
  @IsOptional()
  @IsDateOnly()
  from?: string;
  @ApiPropertyOptional({ description: 'Last day (inclusive)' }) @IsOptional() @IsDateOnly() to?: string;
  @ApiPropertyOptional({ description: 'Voucher number, doctor name or cheque number', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class StatementQuery extends PagingQuery {
  @ApiPropertyOptional({ description: 'First day (inclusive)' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ description: 'Last day (inclusive)' }) @IsOptional() @IsDateOnly() to?: string;
}

export class BreakdownQuery extends PagingQuery {}

export class DebtsQuery extends PagingQuery {
  @ApiPropertyOptional({ enum: ['owed_to_lab', 'owed_by_lab', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['owed_to_lab', 'owed_by_lab', 'all'])
  direction: 'owed_to_lab' | 'owed_by_lab' | 'all' = 'all';
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) search?: string;
}

// ---- Responses ----

class Ref {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
}

class CaseRef {
  @ApiProperty() id!: number;
  @ApiProperty() caseNo!: number;
}

export class ChequeResponse {
  @ApiProperty() id!: number;
  @ApiProperty() chequeNo!: string;
  @ApiProperty() bank!: string;
  @ApiProperty() dueDate!: string;
  @ApiProperty({ enum: CHEQUE_STATUSES }) status!: ChequeStatus;
  @ApiProperty({ type: String, nullable: true }) statusDate!: string | null;
  @ApiProperty({ enum: ['none', 'soon', 'overdue'], description: 'Computed with the lab today' })
  dueState!: DueState;
  @ApiProperty({ enum: CHEQUE_STATUSES, isArray: true, description: 'Statuses the cheque may move to now' })
  allowedStatuses!: ChequeStatus[];
  @ApiProperty() rowVersion!: number;
}

export class PaymentResponse {
  @ApiProperty() id!: number;
  @ApiProperty({ example: 'IN-000001' }) voucherNo!: string;
  @ApiProperty({ type: Ref }) doctor!: Ref;
  @ApiProperty({ type: CaseRef, nullable: true }) case!: CaseRef | null;
  @ApiProperty({ enum: PAYMENT_METHODS }) method!: PaymentMethod;
  @ApiProperty({ ...amountDoc, minimum: 1 }) amount!: number;
  @ApiProperty() currencyCode!: string;
  @ApiProperty() paidAt!: string;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ enum: PAYMENT_STATUSES }) status!: PaymentStatus;
  @ApiProperty({ type: String, nullable: true }) voidReason!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) voidedAt!: string | null;
  @ApiProperty({ description: 'Counts towards the doctor received amount now (SPEC 7.4)' }) counted!: boolean;
  @ApiProperty({ type: ChequeResponse, nullable: true }) cheque!: ChequeResponse | null;
  @ApiProperty() rowVersion!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PaymentResultResponse {
  @ApiProperty({ type: PaymentResponse }) payment!: PaymentResponse;
  @ApiProperty({ description: 'The doctor balance after this change; positive = owed to the lab' })
  doctorBalance!: number;
}

class ChequeHistoryResponse {
  @ApiProperty({ enum: CHEQUE_STATUSES, nullable: true }) fromStatus!: ChequeStatus | null;
  @ApiProperty({ enum: CHEQUE_STATUSES }) toStatus!: ChequeStatus;
  @ApiProperty() statusDate!: string;
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
}

export class PaymentDetailResponse extends PaymentResponse {
  @ApiProperty({ type: [ChequeHistoryResponse] }) chequeHistory!: ChequeHistoryResponse[];
}

class PaymentTotals {
  @ApiProperty({ description: 'Sum of counted payments of the filtered set' }) counted!: number;
  @ApiProperty({ description: 'Sum of cheques still pending in the filtered set' }) pendingCheques!: number;
}

export class PaymentPage extends PageMeta {
  @ApiProperty({ type: [PaymentResponse] }) items!: PaymentResponse[];
  @ApiProperty({ type: PaymentTotals }) totals!: PaymentTotals;
}

export class DoctorBalanceResponse {
  @ApiProperty() doctorId!: number;
  @ApiProperty({ description: 'Signed, minor units' }) openingBalance!: number;
  @ApiProperty({ description: 'Opening balance + sum of non-cancelled case totals' }) charges!: number;
  @ApiProperty({ description: 'Sum of counted payments' }) received!: number;
  @ApiProperty({ description: 'Sum of counted refunds to the doctor (SPEC 7.3 paid_out); raises the balance' })
  paidOut!: number;
  @ApiProperty({ description: 'Sum of pending cheques (not in received)' }) pendingCheques!: number;
  @ApiProperty({ description: 'Sum of refund cheques not cleared yet (not in paidOut; they reserve the credit)' })
  pendingRefundCheques!: number;
  @ApiProperty({ description: 'balance = charges - received + paidOut. Positive = owed to the lab; negative = the lab owes the doctor' })
  balance!: number;
  @ApiProperty({ enum: ['owed_to_lab', 'owed_by_lab', 'settled'] }) direction!: BalanceDirection;
  @ApiProperty({ description: 'What may be refunded now: credit minus pending refund cheques, never below 0' })
  refundable!: number;
}

class StatementLineResponse {
  @ApiProperty() date!: string;
  @ApiProperty({
    enum: STATEMENT_KINDS,
    description: 'refund / refund_cheque_return: money returned to the doctor (B4b) and a returned refund cheque',
  })
  kind!: StatementKind;
  @ApiProperty({ description: 'Case id, payment id or outgoing payment id' }) refId!: number;
  @ApiProperty({ description: 'Case number or voucher number' }) ref!: string;
  @ApiProperty(amountDoc) debit!: number;
  @ApiProperty(amountDoc) credit!: number;
  @ApiProperty({ description: 'Balance after this line, over all of the doctor history' }) running!: number;
  @ApiProperty({ type: String, nullable: true, example: 'IN-000012', description: 'Payment, refund (OUT-) and cheque-return lines' })
  voucher!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Case lines; null without cases.read' })
  patientName!: string | null;
  @ApiProperty({ enum: PAYMENT_METHODS, nullable: true }) method!: PaymentMethod | null;
  @ApiProperty({ type: String, nullable: true }) chequeNo!: string | null;
  @ApiProperty({ type: String, nullable: true }) bank!: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Case number the payment is bound to' })
  boundCaseNo!: number | null;
}

class StatementTotals {
  @ApiProperty(amountDoc) debit!: number;
  @ApiProperty(amountDoc) credit!: number;
}

export class StatementResponse extends PageMeta {
  @ApiProperty({ description: 'Doctor opening balance (before any case)' }) openingBalance!: number;
  @ApiProperty({ description: 'Balance just before the period' }) periodOpening!: number;
  @ApiProperty({ description: 'Balance at the end of the period' }) closing!: number;
  @ApiProperty({ type: StatementTotals, description: 'Debit and credit totals of the chosen range' })
  totals!: StatementTotals;
  @ApiProperty({ type: [StatementLineResponse] }) lines!: StatementLineResponse[];
}

class DebtItem {
  @ApiProperty({ type: Ref }) doctor!: Ref;
  @ApiProperty() active!: boolean;
  @ApiProperty() balance!: number;
  @ApiProperty({ enum: ['owed_to_lab', 'owed_by_lab', 'settled'] }) direction!: BalanceDirection;
  @ApiProperty() pendingCheques!: number;
}

class DebtSummaryResponse {
  @ApiProperty({ description: 'Doctors with a balance other than zero' }) parties!: number;
  @ApiProperty() owedToLab!: number;
  @ApiProperty() owedByLab!: number;
  @ApiProperty({ description: 'owedToLab minus owedByLab' }) net!: number;
}

export class DebtsResponse extends PageMeta {
  @ApiProperty({ type: DebtSummaryResponse }) summary!: DebtSummaryResponse;
  @ApiProperty({ type: [DebtItem] }) items!: DebtItem[];
}

export class LedgerSummaryResponse {
  @ApiProperty({ description: 'Counted payments in the current month (lab time zone)' })
  receivedThisMonth!: number;
  @ApiProperty({ description: 'All counted payments' }) receivedTotal!: number;
  @ApiProperty({ description: 'Sum of positive doctor balances' }) owedToLab!: number;
  @ApiProperty() pendingChequesCount!: number;
  @ApiProperty() pendingChequesAmount!: number;
  @ApiProperty({ description: 'Pending cheques due within 7 days' }) chequesDueSoon!: number;
  @ApiProperty({ description: 'Pending cheques past due' }) chequesOverdue!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'B4b: counted outgoing money (expenses and refunds) this month, by effective date; null without expenses.read',
  })
  outgoingThisMonth!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'All counted outgoing money; null without expenses.read' })
  outgoingTotal!: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Outgoing cheques pending and due within 7 days; null without expenses.read',
  })
  outgoingChequesDueSoon!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Outgoing cheques pending and past due; null without expenses.read' })
  outgoingChequesOverdue!: number | null;
}

export class CasePaymentsResponse {
  @ApiProperty() caseId!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'Bound payments that count + the case FIFO share of unbound ones' })
  paid!: number;
  @ApiProperty() remaining!: number;
  @ApiProperty({ type: [PaymentResponse], description: 'Payments bound to the case (any status)' })
  payments!: PaymentResponse[];
}

// ---- Debts breakdown (B4, SPEC §5.11) ----

class BreakdownTieOut {
  @ApiProperty({ description: 'Unpaid part of a positive opening balance' }) openingRemaining!: number;
  @ApiProperty({ description: 'Sum of remaining over ALL open cases, not of the page' }) casesRemaining!: number;
  @ApiProperty({ description: 'Sum of the refunds the doctor money no longer covers (B4b)' })
  refundsRemaining!: number;
  @ApiProperty({ description: 'Money the lab holds for the doctor (overpayment, negative opening balance)' })
  credit!: number;
  @ApiProperty({
    description: 'openingRemaining + casesRemaining + refundsRemaining - credit; equals GET /doctors/{id}/balance',
  })
  balance!: number;
}

class BreakdownRefund {
  @ApiProperty({ description: 'Outgoing payment id' }) id!: number;
  @ApiProperty({ example: 'OUT-000003' }) voucherNo!: string;
  @ApiProperty({ description: 'Effective date: payment date, or the day the cheque cleared' }) date!: string;
  @ApiProperty(amountDoc) amount!: number;
  @ApiProperty({ ...amountDoc, description: 'Part covered by the doctor money' }) covered!: number;
  @ApiProperty({ ...amountDoc, description: 'Part the doctor owes back; always above 0 here' }) remaining!: number;
}

class BreakdownCase {
  @ApiProperty() id!: number;
  @ApiProperty() caseNo!: number;
  @ApiProperty() patientName!: string;
  @ApiProperty() receivedDate!: string;
  @ApiProperty() status!: string;
  @ApiProperty(amountDoc) total!: number;
  @ApiProperty(amountDoc) paid!: number;
  @ApiProperty({ ...amountDoc, description: 'Always above 0 here' }) remaining!: number;
}

class BreakdownOpenCases extends PageMeta {
  @ApiProperty({ description: 'Number of open cases (all pages)' }) count!: number;
  @ApiProperty({ description: 'Sum of remaining of all open cases (all pages)' }) remaining!: number;
  @ApiProperty({ type: [BreakdownCase], description: 'Oldest first (received date, then case number)' })
  items!: BreakdownCase[];
}

class BreakdownPayment {
  @ApiProperty() id!: number;
  @ApiProperty({ example: 'IN-000001' }) voucherNo!: string;
  @ApiProperty() paidAt!: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) method!: PaymentMethod;
  @ApiProperty(amountDoc) amount!: number;
  @ApiProperty({ description: 'False for a cheque not cleared yet' }) counted!: boolean;
  @ApiProperty({ type: Number, nullable: true }) boundCaseNo!: number | null;
}

export class DebtBreakdownResponse {
  @ApiProperty({ type: Ref }) doctor!: Ref;
  @ApiProperty({ type: DoctorBalanceResponse }) figures!: DoctorBalanceResponse;
  @ApiProperty() openingRemaining!: number;
  @ApiProperty() credit!: number;
  @ApiProperty({ description: 'Sum of openRefunds remaining (B4b)' }) refundsRemaining!: number;
  @ApiProperty({ type: BreakdownTieOut }) tieOut!: BreakdownTieOut;
  @ApiProperty({
    type: [BreakdownRefund],
    description: 'Refunds not covered any more (e.g. the doctor cheque bounced after the refund), oldest first',
  })
  openRefunds!: BreakdownRefund[];
  @ApiProperty({ type: BreakdownOpenCases }) openCases!: BreakdownOpenCases;
  @ApiProperty({ type: [BreakdownPayment], description: 'Latest 10 active payments, newest first' })
  latestPayments!: BreakdownPayment[];
}

// ---- Receipts summary (B4) ----

class ByMethod {
  @ApiProperty(amountDoc) cash!: number;
  @ApiProperty(amountDoc) transfer!: number;
  @ApiProperty(amountDoc) cheque!: number;
}
class CountedSummary {
  @ApiProperty(amountDoc) amount!: number;
  @ApiProperty() count!: number;
  @ApiProperty({ type: ByMethod }) byMethod!: ByMethod;
}
class CountAmount {
  @ApiProperty() count!: number;
  @ApiProperty(amountDoc) amount!: number;
}
class LastPayment {
  @ApiProperty({ example: 'IN-000001' }) voucherNo!: string;
  @ApiProperty() paidAt!: string;
  @ApiProperty(amountDoc) amount!: number;
}
export class PaymentSummaryResponse {
  @ApiProperty({ type: CountedSummary, description: 'Money that counts, on its effective date (a cheque: the day it cleared)' })
  counted!: CountedSummary;
  @ApiProperty({ type: CountAmount, description: 'Memo: cheques not cleared yet, by payment date' })
  pendingCheques!: CountAmount;
  @ApiProperty({ type: CountAmount, description: 'Memo: voided payments, by payment date' }) voided!: CountAmount;
  @ApiProperty({ type: LastPayment, nullable: true }) last!: LastPayment | null;
  @ApiProperty({ enum: ['effective'] }) basis!: 'effective';
}
