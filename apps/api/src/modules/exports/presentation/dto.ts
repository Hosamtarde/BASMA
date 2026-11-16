import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { IsDateOnly } from '../../../shared/http/date-fields';
import { SUPPORTED_LANGUAGES } from '../../../shared/i18n/i18n.service';
import type { Language } from '../../../shared/i18n/i18n.service';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '../../payments/domain/payment-rules';
import type { PaymentMethod, PaymentStatus } from '../../payments/domain/payment-rules';

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

const LANG_DOC = {
  enum: SUPPORTED_LANGUAGES,
  description: 'Language of the headers and labels; default: Accept-Language, then Arabic',
};

/** Language override shared by every export. */
export class ExportLangQuery {
  @ApiPropertyOptional(LANG_DOC) @IsOptional() @IsIn(SUPPORTED_LANGUAGES) lang?: Language;
}

export class DebtsExportQuery extends ExportLangQuery {
  @ApiPropertyOptional({ enum: ['owed_to_lab', 'owed_by_lab', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['owed_to_lab', 'owed_by_lab', 'all'])
  direction: 'owed_to_lab' | 'owed_by_lab' | 'all' = 'all';
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class StatementExportQuery extends ExportLangQuery {
  @ApiPropertyOptional({ description: 'First day (inclusive)' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ description: 'Last day (inclusive)' }) @IsOptional() @IsDateOnly() to?: string;
}

export class PaymentsExportQuery extends ExportLangQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) doctorId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) caseId?: number;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethod;
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES }) @IsOptional() @IsIn(PAYMENT_STATUSES) status?: PaymentStatus;
  @ApiPropertyOptional({ description: 'true: only payments that count now; false: only those that do not' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  counted?: boolean;
  @ApiPropertyOptional({ description: 'Payment date from (inclusive)' }) @IsOptional() @IsDateOnly() from?: string;
  @ApiPropertyOptional({ description: 'Payment date to (inclusive)' }) @IsOptional() @IsDateOnly() to?: string;
  @ApiPropertyOptional({ description: 'Voucher number, doctor name or cheque number', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
