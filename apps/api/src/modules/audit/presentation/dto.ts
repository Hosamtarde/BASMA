import { ApiProperty } from '@nestjs/swagger';

/** No input at all: the page size is fixed. Declared so that any query parameter is rejected. */
export class AuditRecentQuery {}

export class AuditFeedItemResponse {
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiProperty({ description: 'Stable action code, e.g. case.created; the screen labels it per language' })
  action!: string;
  @ApiProperty({ description: 'case, payment, outgoing_payment, cheque, doctor, … (empty when none)' })
  entityType!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Case, voucher or cheque number, or a name; from a whitelist of parameters, null when none',
  })
  entityLabel!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'User name of who did it; null for the system' })
  actor!: string | null;
}

export class AuditRecentResponse {
  @ApiProperty({ type: [AuditFeedItemResponse], description: 'The latest 20, newest first' })
  items!: AuditFeedItemResponse[];
}
