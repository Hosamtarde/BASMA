import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

/** OpenAPI shape of the error envelope written by AllExceptionsFilter (documentation only). */
@ApiSchema({ name: 'FieldError' })
export class FieldErrorDto {
  @ApiProperty({ example: 'lab.phone', description: 'Dotted path of the invalid field' })
  field!: string;

  @ApiProperty({ type: [String], example: ['matches'], description: 'class-validator constraint names' })
  constraints!: string[];
}

@ApiSchema({ name: 'ErrorDetails' })
export class ErrorDetailsDto {
  @ApiPropertyOptional({ type: [FieldErrorDto], description: 'Present on error.validation.failed' })
  fields?: FieldErrorDto[];
}

@ApiSchema({ name: 'ErrorBody' })
export class ErrorBodyDto {
  @ApiProperty({ example: 'error.validation.failed', description: 'Stable catalog code; the UI keys on it' })
  code!: string;

  @ApiProperty({ description: 'Localized message (Accept-Language, fallback ar)' })
  message!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    description: 'Parameters of the message; 5xx errors include correlationId',
  })
  params!: Record<string, string | number>;

  @ApiProperty({
    example: '8f14e45f-ceea-467f-a8f0-4d2e1c7b9a10',
    description: 'Also in the X-Request-Id header',
  })
  correlationId!: string;

  @ApiPropertyOptional({ type: ErrorDetailsDto })
  details?: ErrorDetailsDto;
}

@ApiSchema({ name: 'ErrorEnvelope' })
export class ErrorEnvelopeDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
