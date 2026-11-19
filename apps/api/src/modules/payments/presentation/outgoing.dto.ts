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
  ValidateNested,
} from 'class-validator';
import { IsOptionalNonNull, PageMeta } from '../../../shared/http/common.dto';
import { IsDateOnly } from '../../../shared/http/date-fields';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../shared/http/pagination';
import { OptionalText } from '../../../shared/http/text-fields';
import { MAX_AMOUNT_MINOR } from '../../../shared/money/limits';
import { IsName } from '../../../shared/text/names';
import type {
  ChequeStatus,
  OutgoingKind,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
} from '../domain/payment-rules';
import { CHEQUE_STATUSES, OUTGOING_KINDS, PAYMENT_METHODS, PAYMENT_STATUSES } from '../domain/payment-rules';
import { ChequeInput, ChequeResponse } from './dto';

const amountDoc = { description: 'Integer minor units', minimum: 0 };
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

// ---- Requests ----

export class CreateOutgoingPaymentRequest {
  @ApiProperty({ description: 'Expense category; the doctor-refund category makes it a refund' })
  @IsInt()
  @Min(1)
  categoryId!: number;
  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    nullable: true,
    description: 'Who was paid (free text): required for an expense, forbidden for a refund',
  })
  @IsOptional()
  @IsName(100)
  payee?: string | null;
  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    description: 'The doctor: required for a refund, forbidden for an expense',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  doctorId?: number | null;
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
  @ApiPropertyOptional({
    type: ChequeInput,
    description: 'The lab cheque: required for method=cheque, forbidden otherwise; the due date may be later',
  })
  @IsOptionalNonNull()
  @ValidateNested()
  @Type(() => ChequeInput)
  cheque?: ChequeInput;
}

class OutgoingFilters {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) categoryId?: number;
  @ApiPropertyOptional({ enum: OUTGOING_KINDS }) @IsOptional() @IsIn(OUTGOING_KINDS) kind?: OutgoingKind;
  @ApiPropertyOptional({ description: 'Refunds of this doctor' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  doctorId?: number;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethod;
  @ApiPropertyOptional({ maxLength: 100, description: 'Voucher (OUT-000012, out12, 12), payee, doctor or cheque number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class OutgoingListQuery extends OutgoingFilters {
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES }) @IsOptional() @IsIn(PAYMENT_STATUSES) status?: PaymentStatus;
  @ApiPropertyOptional({ description: 'true: only money that counts now; false: only what does not' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  counted?: boolean;
  @ApiPropertyOptional({ description: 'Payment date from (inclusive)' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ description: 'Payment date to (inclusive)' }) @IsOptional() @IsDateOnly() to?: string;
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

export class ChequeRegisterQuery {
  @ApiPropertyOptional({ enum: ['all', 'in', 'out'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'in', 'out'])
  direction: 'all' | PaymentDirection = 'all';
  @ApiPropertyOptional({ enum: CHEQUE_STATUSES }) @IsOptional() @IsIn(CHEQUE_STATUSES) status?: ChequeStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) doctorId?: number;
  @ApiPropertyOptional({ description: 'Due date from (inclusive)' }) @IsOptional() @IsDateOnly() dueFrom?: string;
  @ApiPropertyOptional({ description: 'Due date to (inclusive)' }) @IsOptional() @IsDateOnly() dueTo?: string;
  @ApiPropertyOptional({ enum: ['soon', 'overdue'] })
  @IsOptional()
  @IsIn(['soon', 'overdue'])
  due?: 'soon' | 'overdue';
  @ApiPropertyOptional({ maxLength: 100, description: 'Cheque number, bank, doctor or payee, voucher (IN-/OUT-)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
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

/** Same filters as the register except direction, status and paging (the chips count every direction). */
export class ChequeRegisterSummaryQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) doctorId?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateOnly() dueFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateOnly() dueTo?: string;
  @ApiPropertyOptional({ enum: ['soon', 'overdue'] })
  @IsOptional()
  @IsIn(['soon', 'overdue'])
  due?: 'soon' | 'overdue';
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) search?: string;
}

// ---- Responses ----

class Ref {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
}

export class OutgoingPaymentResponse {
  @ApiProperty() id!: number;
  @ApiProperty({ example: 'OUT-000001' }) voucherNo!: string;
  @ApiProperty({ enum: OUTGOING_KINDS }) kind!: OutgoingKind;
  @ApiProperty({ type: Ref }) category!: Ref;
  @ApiProperty({ type: Ref, nullable: true, description: 'Refunds only' }) doctor!: Ref | null;
  @ApiProperty({ type: String, nullable: true, description: 'Expenses only' }) payee!: string | null;
  @ApiProperty({ enum: PAYMENT_METHODS }) method!: PaymentMethod;
  @ApiProperty({ ...amountDoc, minimum: 1 }) amount!: number;
  @ApiProperty() currencyCode!: string;
  @ApiProperty() paidAt!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The day it counts: payment date, or the day the cheque cleared; null while it does not count',
  })
  effectiveDate!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ enum: PAYMENT_STATUSES }) status!: PaymentStatus;
  @ApiProperty({ type: String, nullable: true }) voidReason!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) voidedAt!: string | null;
  @ApiProperty({ description: 'Counts as money out now (SPEC 7.4: a cheque once cleared)' }) counted!: boolean;
  @ApiProperty({ type: ChequeResponse, nullable: true }) cheque!: ChequeResponse | null;
  @ApiProperty() rowVersion!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class OutgoingResultResponse {
  @ApiProperty({ type: OutgoingPaymentResponse }) payment!: OutgoingPaymentResponse;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Refunds: the doctor balance after this change (positive = owed to the lab); null for an expense',
  })
  doctorBalance!: number | null;
}

class OutgoingChequeHistory {
  @ApiProperty({ enum: CHEQUE_STATUSES, nullable: true }) fromStatus!: ChequeStatus | null;
  @ApiProperty({ enum: CHEQUE_STATUSES }) toStatus!: ChequeStatus;
  @ApiProperty() statusDate!: string;
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
}

export class OutgoingDetailResponse extends OutgoingPaymentResponse {
  @ApiProperty({ type: [OutgoingChequeHistory] }) chequeHistory!: OutgoingChequeHistory[];
}

class OutgoingTotals {
  @ApiProperty({ description: 'Sum of counted outgoing money of the filtered set' }) counted!: number;
  @ApiProperty({ description: 'Sum of outgoing cheques still pending in the filtered set' }) pendingCheques!: number;
}

export class OutgoingPage extends PageMeta {
  @ApiProperty({ type: [OutgoingPaymentResponse] }) items!: OutgoingPaymentResponse[];
  @ApiProperty({ type: OutgoingTotals }) totals!: OutgoingTotals;
}

class RegisterParty {
  @ApiProperty({ enum: ['doctor', 'payee'] }) kind!: 'doctor' | 'payee';
  @ApiProperty() name!: string;
  @ApiProperty({ type: Number, nullable: true }) doctorId!: number | null;
}

class RegisterPayment {
  @ApiProperty({ description: 'Incoming payment id or outgoing payment id (see direction)' }) id!: number;
  @ApiProperty({ example: 'IN-000001' }) voucherNo!: string;
  @ApiProperty(amountDoc) amount!: number;
  @ApiProperty() paidAt!: string;
}

export class ChequeRegisterItem {
  @ApiProperty({ enum: ['in', 'out'], description: 'in: a doctor cheque to the lab; out: the lab cheque' })
  direction!: PaymentDirection;
  @ApiProperty({ type: ChequeResponse }) cheque!: ChequeResponse;
  @ApiProperty({ type: RegisterPayment }) payment!: RegisterPayment;
  @ApiProperty({ type: RegisterParty }) party!: RegisterParty;
  @ApiProperty({ type: Ref, nullable: true, description: 'Outgoing cheques: the expense category' })
  category!: Ref | null;
}

export class ChequeRegisterPage extends PageMeta {
  @ApiProperty({ type: [ChequeRegisterItem] }) items!: ChequeRegisterItem[];
}

class StatusCounts {
  @ApiProperty() pending!: number;
  @ApiProperty() cleared!: number;
  @ApiProperty() returned!: number;
}
class DirectionCounts {
  @ApiProperty() in!: number;
  @ApiProperty() out!: number;
}
class DirectionAmounts {
  @ApiProperty(amountDoc) in!: number;
  @ApiProperty(amountDoc) out!: number;
}

export class ChequeRegisterSummaryResponse {
  @ApiProperty({ type: StatusCounts }) byStatus!: StatusCounts;
  @ApiProperty({ type: DirectionCounts }) byDirection!: DirectionCounts;
  @ApiProperty({ description: 'Pending, due within 7 days (lab today)' }) dueSoon!: number;
  @ApiProperty({ description: 'Pending and past due' }) overdue!: number;
  @ApiProperty({ type: DirectionAmounts, description: 'Sum of pending cheques per direction' })
  pendingAmount!: DirectionAmounts;
}
