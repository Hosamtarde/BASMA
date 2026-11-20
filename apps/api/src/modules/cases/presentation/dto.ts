import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { IsOptionalNonNull, PageMeta, VersionedPatch } from '../../../shared/http/common.dto';
import { IsDateOnly, IsDateOnlyOrNull } from '../../../shared/http/date-fields';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../shared/http/pagination';
import { OptionalText } from '../../../shared/http/text-fields';
import { IsAmount } from '../../../shared/money/amount.validators';
import { MAX_AMOUNT_MINOR } from '../../../shared/money/limits';
import { IsName } from '../../../shared/text/names';
import { AdvancePaymentInput, ChequeInput, PaymentResponse } from '../../payments/presentation/dto';
import { PAYMENT_METHODS } from '../../payments/domain/payment-rules';
import type { PaymentMethod } from '../../payments/domain/payment-rules';
import { DELIVERY_RECEIVED } from '../domain/delivery-rules';
import type { DeliveryReceived } from '../domain/delivery-rules';
import type { Area, CaseStatus, PriceSource } from '../domain/case-rules';
import { AREAS, CASE_STATUSES, isFdiTooth, MAX_LINES_PER_CASE, PRE_DELIVERY } from '../domain/case-rules';

const IsFdiTooth = () =>
  ValidateBy({
    name: 'isFdiTooth',
    validator: { validate: (v: unknown) => typeof v === 'number' && isFdiTooth(v) },
  });

const STATUS_TARGETS = CASE_STATUSES.filter((s) => s !== 'cancelled');
const amountDoc = { description: 'Integer minor units', minimum: 0 };

// ---- Requests ----

export class CaseLineInput {
  @ApiPropertyOptional({ description: 'FDI tooth 11–48. Exactly one of toothNo / area.', example: 11 })
  @IsOptional()
  @IsInt()
  @IsFdiTooth()
  toothNo?: number;

  @ApiPropertyOptional({
    enum: AREAS,
    description: 'For work not on one tooth. Exactly one of toothNo / area.',
  })
  @IsOptional()
  @IsIn(AREAS)
  area?: Area;

  @ApiProperty() @IsInt() @Min(1) workTypeId!: number;

  @ApiPropertyOptional({ type: String, maxLength: 20, nullable: true, example: 'A2' })
  @OptionalText(20)
  shade?: string | null;

  @ApiPropertyOptional({
    ...amountDoc,
    description: 'Manual price override; omit to use special/general price',
  })
  @IsOptionalNonNull()
  @IsAmount()
  unitPrice?: number;

  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true }) @OptionalText(200) note?:
    string | null;
}

const Lines = () =>
  applyDecorators(
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(MAX_LINES_PER_CASE),
    ValidateNested({ each: true }),
    Type(() => CaseLineInput),
  );

export class CreateCaseRequest {
  @ApiProperty() @IsInt() @Min(1) doctorId!: number;
  @ApiProperty({ maxLength: 100 }) @IsName(100) patientName!: string;
  @ApiPropertyOptional({ type: 'integer', nullable: true }) @IsOptional() @IsInt() @Min(1) technicianId?:
    number | null;
  @ApiPropertyOptional({
    example: '2026-11-06',
    description: 'Default: today (lab time zone); never in the future',
  })
  @IsOptionalNonNull()
  @IsDateOnly()
  receivedDate?: string;
  @ApiProperty({ example: '2026-11-10' }) @IsDateOnly() expectedDate!: string;
  @ApiPropertyOptional({ enum: PRE_DELIVERY, default: 'design' })
  @IsOptionalNonNull()
  @IsIn(PRE_DELIVERY)
  status?: CaseStatus;
  @ApiPropertyOptional({ ...amountDoc, default: 0 }) @IsOptionalNonNull() @IsAmount() discount?: number;
  @ApiPropertyOptional({ type: String, maxLength: 2000, nullable: true }) @OptionalText(2000) notes?:
    string | null;
  @ApiProperty({ type: [CaseLineInput], minItems: 1, maxItems: MAX_LINES_PER_CASE })
  @Lines()
  lines!: CaseLineInput[];
  @ApiPropertyOptional({
    type: AdvancePaymentInput,
    description:
      'Advance payment (SPEC 5.3), created with the case in one transaction and bound to it. Needs the Idempotency-Key header and the payments.write permission.',
  })
  @IsOptionalNonNull()
  @ValidateNested()
  @Type(() => AdvancePaymentInput)
  advance?: AdvancePaymentInput;
}

/** No doctorId: the doctor never changes after creation (owner decision B2). */
export class UpdateCaseRequest extends VersionedPatch {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptionalNonNull() @IsName(100) patientName?: string;
  @ApiPropertyOptional({ type: 'integer', nullable: true }) @IsOptional() @IsInt() @Min(1) technicianId?:
    number | null;
  @ApiPropertyOptional() @IsOptionalNonNull() @IsDateOnly() receivedDate?: string;
  @ApiPropertyOptional() @IsOptionalNonNull() @IsDateOnly() expectedDate?: string;
  @ApiPropertyOptional(amountDoc) @IsOptionalNonNull() @IsAmount() discount?: number;
  @ApiPropertyOptional({ type: String, maxLength: 2000, nullable: true }) @OptionalText(2000) notes?:
    string | null;
}

export class AddCaseLinesRequest extends VersionedPatch {
  @ApiProperty({ type: [CaseLineInput], minItems: 1 }) @Lines() lines!: CaseLineInput[];
}

export class UpdateCaseLineRequest extends VersionedPatch {
  @ApiPropertyOptional({ ...amountDoc, description: 'Sets a manual price (price source becomes manual)' })
  @IsOptionalNonNull()
  @IsAmount()
  unitPrice?: number;
  @ApiPropertyOptional({ type: String, maxLength: 20, nullable: true }) @OptionalText(20) shade?:
    string | null;
  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true }) @OptionalText(200) note?:
    string | null;
}

export class ChangeCaseStatusRequest extends VersionedPatch {
  @ApiProperty({
    enum: STATUS_TARGETS,
    description:
      'Cancel uses POST /cases/{id}/cancel. B5: to=delivered is refused (409 error.case.delivery_required); deliver with POST /cases/{id}/delivery',
  })
  @IsIn(STATUS_TARGETS)
  to!: CaseStatus;
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true }) @OptionalText(500) note?:
    string | null;
  @ApiPropertyOptional({ description: 'Refused (400 error.case.delivered_date_invalid): a date belongs to a delivery' })
  @IsOptionalNonNull()
  @IsDateOnly()
  deliveredDate?: string;
}

/**
 * B5 (SPEC §5.7): hand a case over and say what was received. A full payment is for the amount the
 * server computes (deliveryDue of GET /cases/{id}); the client never sends it.
 */
export class DeliverCaseRequest extends VersionedPatch {
  @ApiPropertyOptional({ description: 'Default today (lab time zone); ≥ received date, ≤ today' })
  @IsOptionalNonNull()
  @IsDateOnly()
  deliveredDate?: string;
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true, description: 'Into the status history' })
  @OptionalText(500)
  note?: string | null;
  @ApiPropertyOptional({
    enum: DELIVERY_RECEIVED,
    description: 'Required when something is due (deliveryDue > 0); omit (or full) when nothing is due',
  })
  @IsOptionalNonNull()
  @IsIn(DELIVERY_RECEIVED)
  received?: DeliveryReceived;
  @ApiPropertyOptional({ description: 'Only with received=partial: integer minor units, below deliveryDue', minimum: 1 })
  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_MINOR)
  amount?: number;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS, description: 'With received=full or partial' })
  @IsOptionalNonNull()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;
  @ApiPropertyOptional({ type: ChequeInput, description: 'Required for method=cheque, forbidden otherwise' })
  @IsOptionalNonNull()
  @ValidateNested()
  @Type(() => ChequeInput)
  cheque?: ChequeInput;
  @ApiPropertyOptional({ description: 'Required with partial / none; ≥ the delivery date; refused otherwise' })
  @IsOptionalNonNull()
  @IsDateOnly()
  collectOn?: string;
}

/** B5: change (or remove with null) the collect date of a delivered case. */
export class SetCollectOnRequest extends VersionedPatch {
  @ApiProperty({ type: String, nullable: true, description: '≥ the delivery date; null removes it' })
  @IsDateOnlyOrNull()
  collectOn!: string | null;
}

export class CancelCaseRequest extends VersionedPatch {
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true }) @OptionalText(500) reason?:
    string | null;
}

/** Filters shared by GET /cases and GET /cases/summary. */
export class CaseFilterQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) doctorId?: number;

  @ApiPropertyOptional({ description: 'Expected date before the lab’s today and still in the lab' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({ description: 'Patient name (contains) or exact case number', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Received date from (inclusive)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;
  @ApiPropertyOptional({ description: 'Received date to (inclusive)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;
}

export class CaseListQueryDto extends CaseFilterQueryDto {
  @ApiPropertyOptional({ enum: CASE_STATUSES }) @IsOptional() @IsIn(CASE_STATUSES) status?: CaseStatus;

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

// ---- Responses ----

class Ref {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
}

export class CaseSummaryResponse {
  @ApiProperty() id!: number;
  @ApiProperty() caseNo!: number;
  @ApiProperty({ type: Ref }) doctor!: Ref;
  @ApiProperty() patientName!: string;
  @ApiProperty({ type: Ref, nullable: true }) technician!: Ref | null;
  @ApiProperty() receivedDate!: string;
  @ApiProperty() expectedDate!: string;
  @ApiProperty({ type: String, nullable: true }) deliveredDate!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'B5: agreed date to collect what is still owed; only while delivered',
  })
  collectOn!: string | null;
  @ApiProperty({ enum: CASE_STATUSES }) status!: CaseStatus;
  @ApiProperty(amountDoc) total!: number;
  @ApiProperty({ description: 'Computed with the lab’s today (time zone setting)' }) overdue!: boolean;
  @ApiProperty() rowVersion!: number;
}

export class CaseListItemResponse extends CaseSummaryResponse {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Bound payments that count + the FIFO share of unbound ones; null without ledger.read',
  })
  paid!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'total - paid; 0 when cancelled; null without ledger.read' })
  remaining!: number | null;
}

export class CaseSummaryPage extends PageMeta {
  @ApiProperty({ type: [CaseListItemResponse] }) items!: CaseListItemResponse[];
}

class CaseLineResponse {
  @ApiProperty() id!: number;
  @ApiProperty({ type: Number, nullable: true }) toothNo!: number | null;
  @ApiProperty({ enum: AREAS, nullable: true }) area!: Area | null;
  @ApiProperty() workTypeId!: number;
  @ApiProperty({ description: 'Snapshot at line creation' }) workTypeName!: string;
  @ApiProperty({ type: String, nullable: true }) shade!: string | null;
  @ApiProperty({ ...amountDoc, description: 'Snapshot price' }) unitPrice!: number;
  @ApiProperty({ enum: ['general', 'special', 'manual'] }) priceSource!: PriceSource;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
}

class CaseHistoryResponse {
  @ApiProperty({ enum: CASE_STATUSES, nullable: true }) fromStatus!: CaseStatus | null;
  @ApiProperty({ enum: CASE_STATUSES }) toStatus!: CaseStatus;
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, nullable: true }) deliveredDate!: string | null;
}

export class CaseDetailResponse extends CaseSummaryResponse {
  @ApiProperty(amountDoc) subtotal!: number;
  @ApiProperty({
    ...amountDoc,
    description: 'Bound payments that count + the case FIFO share of unbound ones',
  })
  paid!: number;
  @ApiProperty({ ...amountDoc, description: 'total - paid; 0 for a cancelled case' }) remaining!: number;
  @ApiProperty({ ...amountDoc, description: 'B5: payments bound to this case whose cheque has not cleared yet' })
  pendingCheques!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'B5: what a delivery may still ask for = remaining − pending bound cheques, ≥ 0; null when delivered or cancelled',
  })
  deliveryDue!: number | null;
  @ApiProperty({
    description: 'B5: delivered, the collect date has come (lab today) and something is still owed («تحصيل مستحق»)',
  })
  collectDue!: boolean;
  @ApiProperty(amountDoc) discount!: number;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: [CaseLineResponse] }) lines!: CaseLineResponse[];
  @ApiProperty({ type: [CaseHistoryResponse] }) history!: CaseHistoryResponse[];
  @ApiProperty({
    enum: CASE_STATUSES,
    isArray: true,
    description:
      'Statuses this case may move to now; empty when none. "delivered" goes through POST /cases/{id}/delivery (B5), every other one through POST /cases/{id}/status',
  })
  allowedStatuses!: CaseStatus[];
  @ApiProperty({ description: 'true when POST /cases/{id}/cancel is allowed now' }) canCancel!: boolean;
  @ApiProperty({ description: 'true when header and lines may be edited (not cancelled)' }) canEdit!: boolean;
}

export class DeliverCaseResponse {
  @ApiProperty({ type: CaseDetailResponse }) case!: CaseDetailResponse;
  @ApiProperty({ type: PaymentResponse, nullable: true, description: 'The payment taken at delivery, if any' })
  payment!: PaymentResponse | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Doctor balance after the payment; null without one' })
  doctorBalance!: number | null;
}

export class CreateCaseResponse extends CaseDetailResponse {
  @ApiProperty({ type: PaymentResponse, nullable: true, description: 'The advance payment, if one was sent' })
  advancePayment!: PaymentResponse | null;
}

/** One count per status, every status always present (0 when none). */
export class CaseStatusCounts {
  @ApiProperty() waiting!: number;
  @ApiProperty() design!: number;
  @ApiProperty() in_progress!: number;
  @ApiProperty() ready!: number;
  @ApiProperty() delivered!: number;
  @ApiProperty() returned!: number;
  @ApiProperty() cancelled!: number;
}

export class CaseCountsResponse {
  @ApiProperty({ type: CaseStatusCounts }) byStatus!: CaseStatusCounts;
  @ApiProperty({ description: 'All matching cases (sum of byStatus)' }) total!: number;
  @ApiProperty({ description: 'Matching cases that are overdue (lab’s today, same rule as the list)' })
  overdue!: number;
}

export class ShadeUsageQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 24, default: 8, description: 'How many shades to return' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  limit: number = 8;
}

export class ShadeUsageItem {
  @ApiProperty({ description: 'The shade as written on the lines (free text, up to 20 characters)' }) shade!: string;
  @ApiProperty({ description: 'Lines of cases that are not cancelled' }) count!: number;
}

export class ShadeUsageResponse {
  @ApiProperty({ type: [ShadeUsageItem], description: 'Most used first, then by shade' }) items!: ShadeUsageItem[];
}
