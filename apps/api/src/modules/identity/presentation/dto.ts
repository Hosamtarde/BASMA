import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches, MaxLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from '../domain/credentials-policy';

// ---- Requests ----

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
