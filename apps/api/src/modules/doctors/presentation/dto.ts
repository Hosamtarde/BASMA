import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsOptionalNonNull, PageMeta, VersionedPatch } from '../../../shared/http/common.dto';
import { IsAmount, IsSignedAmount } from '../../../shared/money/amount.validators';
import { IsName, normalizeOptionalText } from '../../../shared/text/names';
import { CLINIC_MAX_LENGTH, NOTES_MAX_LENGTH, PHONE_MAX_LENGTH, PHONE_PATTERN } from '../domain/doctor-rules';

/** Optional, nullable free text: trimmed; blank or null clears it. */
const OptionalText = (max: number) =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) => normalizeOptionalText(value)),
    IsOptional(),
    IsString(),
    MaxLength(max),
  );

const OptionalPhone = () => applyDecorators(OptionalText(PHONE_MAX_LENGTH), Matches(PHONE_PATTERN));

const balanceDoc = {
  description: 'Signed, integer minor units: > 0 the doctor owes the lab, < 0 the lab owes the doctor',
  example: 0,
};

export class CreateDoctorRequest {
  @ApiProperty({ maxLength: 100, example: 'د. أحمد سالم' }) @IsName() name!: string;
  @ApiPropertyOptional({ maxLength: PHONE_MAX_LENGTH, nullable: true }) @OptionalPhone() phone?:
    string | null;
  @ApiPropertyOptional({ maxLength: CLINIC_MAX_LENGTH, nullable: true })
  @OptionalText(CLINIC_MAX_LENGTH)
  clinic?: string | null;
  @ApiPropertyOptional({ maxLength: NOTES_MAX_LENGTH, nullable: true })
  @OptionalText(NOTES_MAX_LENGTH)
  notes?: string | null;
  @ApiPropertyOptional({ ...balanceDoc, default: 0 })
  @IsOptionalNonNull()
  @IsSignedAmount()
  openingBalance: number = 0;
}

export class UpdateDoctorRequest extends VersionedPatch {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptionalNonNull() @IsName() name?: string;
  @ApiPropertyOptional({ maxLength: PHONE_MAX_LENGTH, nullable: true }) @OptionalPhone() phone?:
    string | null;
  @ApiPropertyOptional({ maxLength: CLINIC_MAX_LENGTH, nullable: true })
  @OptionalText(CLINIC_MAX_LENGTH)
  clinic?: string | null;
  @ApiPropertyOptional({ maxLength: NOTES_MAX_LENGTH, nullable: true })
  @OptionalText(NOTES_MAX_LENGTH)
  notes?: string | null;
  @ApiPropertyOptional(balanceDoc) @IsOptionalNonNull() @IsSignedAmount() openingBalance?: number;
  @ApiPropertyOptional() @IsOptionalNonNull() @IsBoolean() active?: boolean;
}

export class DoctorResponse {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) clinic!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty(balanceDoc) openingBalance!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty() rowVersion!: number;
}

export class DoctorPage extends PageMeta {
  @ApiProperty({ type: [DoctorResponse] }) items!: DoctorResponse[];
}

export class SetDoctorPriceRequest {
  @ApiProperty({ description: 'Integer minor units', minimum: 0, example: 20000 }) @IsAmount() price!: number;
}

export class DoctorPriceResponse {
  @ApiProperty() workTypeId!: number;
  @ApiProperty() workTypeName!: string;
  @ApiProperty() workTypeActive!: boolean;
  @ApiProperty({ description: 'General price per tooth, minor units' }) generalPrice!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'null = the general price applies' })
  specialPrice!: number | null;
}
