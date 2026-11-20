import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  DOCUMENT_LANGUAGES,
  INVOICE_COLUMNS,
  INVOICE_FONT_SIZES,
  INVOICE_STATUSES,
  INVOICE_TYPES,
  MAX_AMOUNT_MINOR,
  MAX_CASES_PER_INVOICE,
  MAX_INVOICE_NOTES,
  MAX_INVOICE_REASON,
  MAX_PARTY_NAME,
  MAX_VOID_REASON,
} from '@app/shared';
import type { DocumentLanguage, InvoiceStatus, InvoiceType } from '@app/shared';
import { IsOptionalNonNull, PageMeta, VersionedPatch } from '../../../shared/http/common.dto';
import { IsDateOnly } from '../../../shared/http/date-fields';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../shared/http/pagination';
import { OptionalText } from '../../../shared/http/text-fields';
import { IsName, normalizeName } from '../../../shared/text/names';

const amountDoc = { description: 'Integer minor units', example: 25000 };

// ---------------------------------------------------------------- requests

export class CreateInvoiceRequest {
  @ApiProperty({ enum: INVOICE_TYPES }) @IsIn(INVOICE_TYPES) type!: InvoiceType;

  @ApiPropertyOptional({ description: 'cases, statement: required; free: the doctor, or give partyName instead' })
  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  doctorId?: number;

  @ApiPropertyOptional({ type: [Number], description: `cases only: 1–${MAX_CASES_PER_INVOICE} case ids of the doctor` })
  @IsOptionalNonNull()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CASES_PER_INVOICE)
  @IsInt({ each: true })
  @Min(1, { each: true })
  caseIds?: number[];

  @ApiPropertyOptional({
    ...amountDoc,
    description: 'cases only: the total the screen previewed; a different server total → 409 error.invoice.total_changed',
  })
  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_MINOR)
  expectedTotal?: number;

  @ApiPropertyOptional({ type: String, maxLength: MAX_INVOICE_NOTES, nullable: true })
  @OptionalText(MAX_INVOICE_NOTES)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'statement only: first date (inclusive)' })
  @IsOptionalNonNull()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'statement only: last date (inclusive)' })
  @IsOptionalNonNull()
  @IsDateOnly()
  to?: string;

  @ApiPropertyOptional({ maxLength: MAX_PARTY_NAME, description: 'free only, when the party is not a doctor' })
  @IsOptionalNonNull()
  @IsName(MAX_PARTY_NAME)
  partyName?: string;

  @ApiPropertyOptional({ maxLength: MAX_INVOICE_REASON, description: 'free only' })
  @IsOptionalNonNull()
  @IsName(MAX_INVOICE_REASON)
  reason?: string;

  @ApiPropertyOptional({ ...amountDoc, description: 'free only: > 0' })
  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_MINOR)
  amount?: number;

  @ApiPropertyOptional({ enum: DOCUMENT_LANGUAGES, description: 'Default: the documents language of Settings' })
  @IsOptionalNonNull()
  @IsIn(DOCUMENT_LANGUAGES)
  language?: DocumentLanguage;
}

export class VoidInvoiceRequest extends VersionedPatch {
  @ApiProperty({ maxLength: MAX_VOID_REASON })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeName(value) : value))
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_VOID_REASON)
  reason!: string;
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

export class InvoiceListQuery extends PagingQuery {
  @ApiPropertyOptional({ enum: INVOICE_TYPES }) @IsOptional() @IsIn(INVOICE_TYPES) type?: InvoiceType;
  @ApiPropertyOptional({ enum: INVOICE_STATUSES }) @IsOptional() @IsIn(INVOICE_STATUSES) status?: InvoiceStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) doctorId?: number;
  @ApiPropertyOptional({ description: 'Issue date from (inclusive)' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ description: 'Issue date to (inclusive)' }) @IsOptional() @IsDateOnly() to?: string;
  @ApiPropertyOptional({ maxLength: 100, description: 'Invoice number or party name' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class EligibleCasesQuery extends PagingQuery {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) doctorId!: number;
}

// ---------------------------------------------------------------- responses

class Ref {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
}

export class InvoiceListItemResponse {
  @ApiProperty() id!: number;
  @ApiProperty() no!: number;
  @ApiProperty({ enum: INVOICE_TYPES }) type!: InvoiceType;
  @ApiProperty({ enum: INVOICE_STATUSES }) status!: InvoiceStatus;
  @ApiProperty({ example: '2026-11-20' }) issueDate!: string;
  @ApiProperty({ enum: DOCUMENT_LANGUAGES }) language!: DocumentLanguage;
  @ApiProperty() currencyCode!: string;
  @ApiProperty({ type: Number, nullable: true, description: 'The doctor (null for a free invoice to a typed name)' })
  doctorId!: number | null;
  @ApiProperty({ description: 'The party as printed (frozen at issue)' }) partyName!: string;
  @ApiProperty({ type: Number, nullable: true, ...amountDoc, description: 'null for a statement' }) subtotal!: number | null;
  @ApiProperty({ type: Number, nullable: true, ...amountDoc, description: 'null for a statement' }) discount!: number | null;
  @ApiProperty({ type: Number, nullable: true, ...amountDoc, description: 'null for a statement' }) total!: number | null;
  @ApiProperty({ type: String, nullable: true }) voidReason!: string | null;
  @ApiProperty({ type: String, nullable: true }) voidedAt!: string | null;
  @ApiProperty() rowVersion!: number;
  @ApiProperty() createdAt!: string;
}

export class InvoiceResponse extends InvoiceListItemResponse {
  @ApiProperty({ description: 'Renderer contract version of the snapshot' }) snapshotVersion!: number;
  @ApiProperty({ description: 'SHA-256 of the canonical snapshot JSON, verified on every read' }) snapshotSha256!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Everything printed, frozen at issue (InvoiceSnapshot in @app/shared). Never changes.',
  })
  snapshot!: Record<string, unknown>;
}

export class InvoicePage extends PageMeta {
  @ApiProperty({ type: [InvoiceListItemResponse] }) items!: InvoiceListItemResponse[];
}

export class InvoicePreviewResponse {
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The snapshot that would be frozen; no = 0' })
  snapshot!: Record<string, unknown>;
}

class InvoiceCountsByType {
  @ApiProperty() cases!: number;
  @ApiProperty() statement!: number;
  @ApiProperty() free!: number;
}

export class InvoiceSummaryResponse {
  @ApiProperty({ type: InvoiceCountsByType, description: 'Active documents per type' }) active!: InvoiceCountsByType;
  @ApiProperty({ description: 'Voided documents' }) void!: number;
}

export class EligibleCaseResponse {
  @ApiProperty() caseId!: number;
  @ApiProperty() caseNo!: number;
  @ApiProperty() patientName!: string;
  @ApiProperty() receivedDate!: string;
  @ApiProperty({ type: String, nullable: true }) deliveredDate!: string | null;
  @ApiProperty({ enum: ['delivered', 'ready'] }) status!: string;
  @ApiProperty(amountDoc) total!: number;
  @ApiProperty(amountDoc) paid!: number;
  @ApiProperty(amountDoc) remaining!: number;
}

export class EligibleCasePage extends PageMeta {
  @ApiProperty({ type: Ref }) doctor!: Ref;
  @ApiProperty({ type: [EligibleCaseResponse] }) items!: EligibleCaseResponse[];
}

// ---------------------------------------------------------------- template

class InvoiceMarginsDto {
  @ApiProperty({ minimum: 5, maximum: 30 }) top!: number;
  @ApiProperty({ minimum: 5, maximum: 30 }) end!: number;
  @ApiProperty({ minimum: 5, maximum: 30 }) bottom!: number;
  @ApiProperty({ minimum: 5, maximum: 30 }) start!: number;
}

class InvoiceWidthsDto {
  @ApiPropertyOptional({ minimum: 8, maximum: 80 }) caseNo?: number;
  @ApiPropertyOptional({ minimum: 8, maximum: 80 }) patient?: number;
  @ApiPropertyOptional({ minimum: 8, maximum: 80 }) teeth?: number;
  @ApiPropertyOptional({ minimum: 8, maximum: 80 }) workType?: number;
  @ApiPropertyOptional({ minimum: 8, maximum: 80 }) shade?: number;
  @ApiPropertyOptional({ minimum: 8, maximum: 80 }) qty?: number;
  @ApiPropertyOptional({ minimum: 8, maximum: 80 }) unitPrice?: number;
  @ApiPropertyOptional({ minimum: 8, maximum: 80 }) lineTotal?: number;
}

/** Documentation shape; the body is validated as a whole by the shared strict validator (plan §5). */
export class InvoiceTemplateDto {
  @ApiProperty({ pattern: '^#[0-9A-Fa-f]{6}$', example: '#006EBD' }) primaryColor!: string;
  @ApiProperty({ pattern: '^#[0-9A-Fa-f]{6}$', example: '#FFFFFF' }) headerTextColor!: string;
  @ApiProperty({ pattern: '^#[0-9A-Fa-f]{6}$', example: '#01416C' }) tableHeaderColor!: string;
  @ApiProperty({ enum: INVOICE_FONT_SIZES }) fontSize!: (typeof INVOICE_FONT_SIZES)[number];
  @ApiProperty({ type: InvoiceMarginsDto, description: 'Millimetres' }) margins!: InvoiceMarginsDto;
  @ApiProperty({ enum: INVOICE_COLUMNS, isArray: true, description: 'Visible columns in order; lineTotal is required' })
  columns!: (typeof INVOICE_COLUMNS)[number][];
  @ApiProperty({ type: InvoiceWidthsDto, description: 'Millimetres; a missing column is auto width' }) widths!: InvoiceWidthsDto;
  @ApiProperty() showLogo!: boolean;
  @ApiProperty() showBalances!: boolean;
  @ApiProperty({ maxLength: 300, description: 'Plain text, at most 3 lines; never HTML' }) footerText!: string;
}

export class InvoiceTemplateResponse {
  @ApiProperty({ type: InvoiceTemplateDto }) template!: InvoiceTemplateDto;
  @ApiProperty({ description: '0 = never saved (defaults); send it back on save' }) rowVersion!: number;
}

export class SaveInvoiceTemplateRequest {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) rowVersion!: number;
  @ApiProperty({ type: InvoiceTemplateDto }) @IsObject() template!: Record<string, unknown>;
}
