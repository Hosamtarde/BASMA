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
import { IsDateOnly } from '../../../shared/http/date-fields';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../shared/http/pagination';
import { OptionalText } from '../../../shared/http/text-fields';
import { IsAmount } from '../../../shared/money/amount.validators';
import { IsName } from '../../../shared/text/names';
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

  @ApiPropertyOptional({ maxLength: 20, nullable: true, example: 'A2' }) @OptionalText(20) shade?:
    string | null;

  @ApiPropertyOptional({
    ...amountDoc,
    description: 'Manual price override; omit to use special/general price',
  })
  @IsOptionalNonNull()
  @IsAmount()
  unitPrice?: number;

  @ApiPropertyOptional({ maxLength: 200, nullable: true }) @OptionalText(200) note?: string | null;
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
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) technicianId?: number | null;
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
  @ApiPropertyOptional({ maxLength: 2000, nullable: true }) @OptionalText(2000) notes?: string | null;
  @ApiProperty({ type: [CaseLineInput], minItems: 1, maxItems: MAX_LINES_PER_CASE })
  @Lines()
  lines!: CaseLineInput[];
}

/** No doctorId: the doctor never changes after creation (owner decision B2). */
export class UpdateCaseRequest extends VersionedPatch {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptionalNonNull() @IsName(100) patientName?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) technicianId?: number | null;
  @ApiPropertyOptional() @IsOptionalNonNull() @IsDateOnly() receivedDate?: string;
  @ApiPropertyOptional() @IsOptionalNonNull() @IsDateOnly() expectedDate?: string;
  @ApiPropertyOptional(amountDoc) @IsOptionalNonNull() @IsAmount() discount?: number;
  @ApiPropertyOptional({ maxLength: 2000, nullable: true }) @OptionalText(2000) notes?: string | null;
}

export class AddCaseLinesRequest extends VersionedPatch {
  @ApiProperty({ type: [CaseLineInput], minItems: 1 }) @Lines() lines!: CaseLineInput[];
}

export class UpdateCaseLineRequest extends VersionedPatch {
  @ApiPropertyOptional({ ...amountDoc, description: 'Sets a manual price (price source becomes manual)' })
  @IsOptionalNonNull()
  @IsAmount()
  unitPrice?: number;
  @ApiPropertyOptional({ maxLength: 20, nullable: true }) @OptionalText(20) shade?: string | null;
  @ApiPropertyOptional({ maxLength: 200, nullable: true }) @OptionalText(200) note?: string | null;
}

export class ChangeCaseStatusRequest extends VersionedPatch {
  @ApiProperty({ enum: STATUS_TARGETS, description: 'Cancel uses POST /cases/{id}/cancel' })
  @IsIn(STATUS_TARGETS)
  to!: CaseStatus;
  @ApiPropertyOptional({ maxLength: 500, nullable: true }) @OptionalText(500) note?: string | null;
  @ApiPropertyOptional({ description: 'Only with to=delivered; default today; ≥ received, ≤ today' })
  @IsOptionalNonNull()
  @IsDateOnly()
  deliveredDate?: string;
}

export class CancelCaseRequest extends VersionedPatch {
  @ApiPropertyOptional({ maxLength: 500, nullable: true }) @OptionalText(500) reason?: string | null;
}

export class CaseListQueryDto {
  @ApiPropertyOptional({ enum: CASE_STATUSES }) @IsOptional() @IsIn(CASE_STATUSES) status?: CaseStatus;

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
  @ApiProperty({ enum: CASE_STATUSES }) status!: CaseStatus;
  @ApiProperty(amountDoc) total!: number;
  @ApiProperty({ description: 'Computed with the lab’s today (time zone setting)' }) overdue!: boolean;
  @ApiProperty() rowVersion!: number;
}

export class CaseSummaryPage extends PageMeta {
  @ApiProperty({ type: [CaseSummaryResponse] }) items!: CaseSummaryResponse[];
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
  @ApiProperty(amountDoc) discount!: number;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: [CaseLineResponse] }) lines!: CaseLineResponse[];
  @ApiProperty({ type: [CaseHistoryResponse] }) history!: CaseHistoryResponse[];
  @ApiProperty({
    enum: CASE_STATUSES,
    isArray: true,
    description: 'Statuses this case may move to now (POST /cases/{id}/status); empty when none',
  })
  allowedStatuses!: CaseStatus[];
  @ApiProperty({ description: 'true when POST /cases/{id}/cancel is allowed now' }) canCancel!: boolean;
  @ApiProperty({ description: 'true when header and lines may be edited (not cancelled)' }) canEdit!: boolean;
}
