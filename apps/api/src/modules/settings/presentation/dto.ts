import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, Min, ValidateBy } from 'class-validator';
import { IsOptionalNonNull, VersionedPatch } from '../../../shared/http/common.dto';
import { OptionalPhone, OptionalText, PHONE_MAX_LENGTH } from '../../../shared/http/text-fields';
import { SUPPORTED_LANGUAGES } from '../../../shared/i18n/i18n.service';
import type { Language } from '../../../shared/i18n/i18n.service';
import { IsName } from '../../../shared/text/names';
import { isValidTimeZone, MAX_COUNTER_START } from '../domain/settings-rules';

export const LAB_NAME_MAX_LENGTH = 100;
export const ADDRESS_MAX_LENGTH = 300;

export const IsTimeZoneName = () =>
  ValidateBy({
    name: 'isTimeZone',
    validator: { validate: (value: unknown) => typeof value === 'string' && isValidTimeZone(value) },
  });

// ---- Shared request parts (also used by first-run setup) ----

export class LabProfileInput {
  @ApiPropertyOptional({ maxLength: LAB_NAME_MAX_LENGTH, nullable: true, example: 'مختبر الأسنان' })
  @OptionalText(LAB_NAME_MAX_LENGTH)
  nameAr?: string | null;

  @ApiPropertyOptional({ maxLength: LAB_NAME_MAX_LENGTH, nullable: true, example: 'Dental Lab' })
  @OptionalText(LAB_NAME_MAX_LENGTH)
  nameEn?: string | null;

  @ApiPropertyOptional({ maxLength: PHONE_MAX_LENGTH, nullable: true }) @OptionalPhone() phone?:
    string | null;

  @ApiPropertyOptional({ maxLength: ADDRESS_MAX_LENGTH, nullable: true })
  @OptionalText(ADDRESS_MAX_LENGTH)
  address?: string | null;
}

export class CurrencyInput {
  @ApiProperty({ maxLength: 10, example: 'ILS', description: 'Free text code (SPEC §5.18)' })
  @IsName(10)
  code!: string;

  @ApiProperty({ maxLength: 5, example: '₪' }) @IsName(5) symbol!: string;

  @ApiProperty({ minimum: 0, maximum: 3, example: 2 }) @IsInt() @Min(0) @Max(3) decimals!: number;
}

// ---- PATCH requests ----

export class UpdateLabProfileRequest extends LabProfileInput {
  @ApiProperty() @IsInt() @Min(1) rowVersion!: number;

  @ApiPropertyOptional({ example: 'Asia/Hebron' })
  @IsOptionalNonNull()
  @IsString()
  @IsTimeZoneName()
  timeZone?: string;
}

export class UpdateCurrencyRequest extends VersionedPatch {
  @ApiPropertyOptional({ maxLength: 10, description: 'Locked once any amount exists' })
  @IsOptionalNonNull()
  @IsName(10)
  code?: string;

  @ApiPropertyOptional({ maxLength: 5, description: 'Always editable' })
  @IsOptionalNonNull()
  @IsName(5)
  symbol?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 3, description: 'Locked once any amount exists' })
  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  @Max(3)
  decimals?: number;
}

export class UpdateLanguageRequest extends VersionedPatch {
  @ApiPropertyOptional({ enum: SUPPORTED_LANGUAGES })
  @IsOptionalNonNull()
  @IsIn(SUPPORTED_LANGUAGES)
  ui?: Language;

  @ApiPropertyOptional({ enum: SUPPORTED_LANGUAGES, description: 'Language of printed documents' })
  @IsOptionalNonNull()
  @IsIn(SUPPORTED_LANGUAGES)
  documents?: Language;
}

export class UpdateNumberingRequest {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_COUNTER_START, description: 'First case number' })
  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(MAX_COUNTER_START)
  caseNoStart?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_COUNTER_START, description: 'First invoice number' })
  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(MAX_COUNTER_START)
  invoiceNoStart?: number;
}

// ---- Response ----

class LabProfileView {
  @ApiProperty({ type: String, nullable: true }) nameAr!: string | null;
  @ApiProperty({ type: String, nullable: true }) nameEn!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty() timeZone!: string;
  @ApiProperty() rowVersion!: number;
}

class CurrencyLocks {
  @ApiProperty() code!: boolean;
  @ApiProperty() decimals!: boolean;
}

class CurrencyView {
  @ApiProperty() code!: string;
  @ApiProperty() symbol!: string;
  @ApiProperty() decimals!: number;
  @ApiProperty() rowVersion!: number;
  @ApiProperty({ type: CurrencyLocks, description: 'true once any amount exists' }) locked!: CurrencyLocks;
}

class LanguageView {
  @ApiProperty({ enum: SUPPORTED_LANGUAGES }) ui!: Language;
  @ApiProperty({ enum: SUPPORTED_LANGUAGES }) documents!: Language;
  @ApiProperty() rowVersion!: number;
}

class CounterView {
  @ApiProperty() startValue!: number;
  @ApiProperty() nextValue!: number;
  @ApiProperty({ description: 'true once a number was issued' }) locked!: boolean;
}

class NumberingView {
  @ApiProperty({ type: CounterView }) caseNo!: CounterView;
  @ApiProperty({ type: CounterView }) invoiceNo!: CounterView;
}

export class SettingsResponse {
  @ApiProperty({ type: LabProfileView, nullable: true }) labProfile!: LabProfileView | null;
  @ApiProperty({ type: CurrencyView, nullable: true }) currency!: CurrencyView | null;
  @ApiProperty({ type: LanguageView, nullable: true }) language!: LanguageView | null;
  @ApiProperty({ type: NumberingView }) numbering!: NumberingView;
}
