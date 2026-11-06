import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsOptionalNonNull } from '../../../shared/http/common.dto';
import { OptionalText, PHONE_MAX_LENGTH, PHONE_PATTERN } from '../../../shared/http/text-fields';
import { SUPPORTED_LANGUAGES } from '../../../shared/i18n/i18n.service';
import type { Language } from '../../../shared/i18n/i18n.service';
import { normalizeOptionalText } from '../../../shared/text/names';
import {
  ADDRESS_MAX_LENGTH,
  CurrencyInput,
  IsTimeZoneName,
  LAB_NAME_MAX_LENGTH,
} from '../../settings/presentation/dto';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from '../domain/credentials-policy';

// ---- Requests ----

/** First-run lab details (SPEC §5.18): a name in Arabic or English, and a phone, are required. */
export class SetupLabProfile {
  @ApiPropertyOptional({ maxLength: LAB_NAME_MAX_LENGTH, nullable: true, example: 'مختبر الأسنان' })
  @OptionalText(LAB_NAME_MAX_LENGTH)
  nameAr?: string | null;

  @ApiPropertyOptional({ maxLength: LAB_NAME_MAX_LENGTH, nullable: true, example: 'Dental Lab' })
  @OptionalText(LAB_NAME_MAX_LENGTH)
  nameEn?: string | null;

  @ApiProperty({ maxLength: PHONE_MAX_LENGTH, example: '02 222 3333' })
  @Transform(({ value }: { value: unknown }) => normalizeOptionalText(value))
  @IsString()
  @MaxLength(PHONE_MAX_LENGTH)
  @Matches(PHONE_PATTERN)
  phone!: string;

  @ApiPropertyOptional({ maxLength: ADDRESS_MAX_LENGTH, nullable: true })
  @OptionalText(ADDRESS_MAX_LENGTH)
  address?: string | null;
}

export class SetupRequest {
  @ApiProperty({ minLength: USERNAME_MIN_LENGTH, maxLength: USERNAME_MAX_LENGTH, example: 'owner' })
  @IsString()
  @Length(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH)
  @Matches(USERNAME_PATTERN)
  username!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH, format: 'password' })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiProperty({ type: SetupLabProfile })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SetupLabProfile)
  lab!: SetupLabProfile;

  @ApiProperty({ type: CurrencyInput })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CurrencyInput)
  currency!: CurrencyInput;

  @ApiProperty({
    enum: SUPPORTED_LANGUAGES,
    description: 'UI and document language; seed names are created in it and never renamed later',
  })
  @IsIn(SUPPORTED_LANGUAGES)
  language!: Language;

  @ApiPropertyOptional({ example: 'Asia/Hebron', description: 'Default: DEFAULT_TIME_ZONE of the install' })
  @IsOptionalNonNull()
  @IsString()
  @IsTimeZoneName()
  timeZone?: string;
}

/** Login does not apply the policy (it may change later); it only bounds the input size. */
export class LoginRequest {
  @ApiProperty({ example: 'owner' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(USERNAME_MAX_LENGTH)
  username!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class RefreshTokenRequest {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refreshToken!: string;
}

export class ChangePasswordRequest {
  @ApiProperty({ format: 'password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH, format: 'password' })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

// ---- Responses ----

export class SetupStatusResponse {
  @ApiProperty({ description: 'true until the owner account has been created' })
  setupRequired!: boolean;
}

export class SetupResponse {
  @ApiProperty() id!: number;
  @ApiProperty() username!: string;
}

export class TokenResponse {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ description: 'Seconds' }) accessTokenExpiresIn!: number;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ type: String, format: 'date-time' }) refreshTokenExpiresAt!: string;
  @ApiProperty() mustChangePassword!: boolean;
}

export class MeResponse {
  @ApiProperty() id!: number;
  @ApiProperty() username!: string;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty() mustChangePassword!: boolean;
}
