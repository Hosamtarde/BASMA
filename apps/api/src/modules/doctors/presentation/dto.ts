import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { IsOptionalNonNull, PageMeta, VersionedPatch } from '../../../shared/http/common.dto';
import { OptionalPhone, OptionalText, PHONE_MAX_LENGTH } from '../../../shared/http/text-fields';
import { IsAmount, IsSignedAmount } from '../../../shared/money/amount.validators';
import { IsName } from '../../../shared/text/names';
import { CLINIC_MAX_LENGTH, NOTES_MAX_LENGTH } from '../domain/doctor-rules';

const balanceDoc = {
  description: 'Signed, integer minor units: > 0 the doctor owes the lab, < 0 the lab owes the doctor',
  example: 0,
};

export class CreateDoctorRequest {
  @ApiProperty({ maxLength: 100, example: 'د. أحمد سالم' }) @IsName() name!: string;
  @ApiPropertyOptional({ type: String, maxLength: PHONE_MAX_LENGTH, nullable: true })
  @OptionalPhone()
  phone?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: CLINIC_MAX_LENGTH, nullable: true })
  @OptionalText(CLINIC_MAX_LENGTH)
  clinic?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: NOTES_MAX_LENGTH, nullable: true })
  @OptionalText(NOTES_MAX_LENGTH)
  notes?: string | null;
  @ApiPropertyOptional({ ...balanceDoc, default: 0 })
  @IsOptionalNonNull()
  @IsSignedAmount()
  openingBalance: number = 0;
}

export class UpdateDoctorRequest extends VersionedPatch {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptionalNonNull() @IsName() name?: string;
  @ApiPropertyOptional({ type: String, maxLength: PHONE_MAX_LENGTH, nullable: true })
  @OptionalPhone()
  phone?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: CLINIC_MAX_LENGTH, nullable: true })
  @OptionalText(CLINIC_MAX_LENGTH)
  clinic?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: NOTES_MAX_LENGTH, nullable: true })
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
