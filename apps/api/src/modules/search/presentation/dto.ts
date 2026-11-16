import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min, IsOptional } from 'class-validator';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '../../payments/domain/payment-rules';
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from '../application/search.service';

export class SearchQuery {
  @ApiProperty({ minLength: 1, maxLength: 100, description: 'What to look for; trimmed' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  q!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: SEARCH_MAX_LIMIT, default: SEARCH_DEFAULT_LIMIT, description: 'Hits per group' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_LIMIT)
  limit: number = SEARCH_DEFAULT_LIMIT;
}

class DoctorHitResponse {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) clinic!: string | null;
  @ApiProperty() active!: boolean;
}
class CaseHitResponse {
  @ApiProperty() id!: number;
  @ApiProperty() caseNo!: number;
  @ApiProperty() patientName!: string;
  @ApiProperty() doctorName!: string;
  @ApiProperty() status!: string;
  @ApiProperty() receivedDate!: string;
}
class PaymentHitResponse {
  @ApiProperty() id!: number;
  @ApiProperty({ example: 'IN-000001' }) voucher!: string;
  @ApiProperty() doctorName!: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) method!: string;
  @ApiProperty({ description: 'Integer minor units' }) amount!: number;
  @ApiProperty() paidAt!: string;
  @ApiProperty({ enum: PAYMENT_STATUSES }) status!: string;
}

class GroupMeta {
  @ApiProperty({ description: 'All matches, not only the ones returned' }) total!: number;
  @ApiProperty({ description: 'True when nothing matched the whole text and these are the closest matches' })
  closest!: boolean;
}
export class DoctorGroup extends GroupMeta {
  @ApiProperty({ type: [DoctorHitResponse] }) items!: DoctorHitResponse[];
}
export class CaseGroup extends GroupMeta {
  @ApiProperty({ type: [CaseHitResponse] }) items!: CaseHitResponse[];
}
export class PaymentGroup extends GroupMeta {
  @ApiProperty({ type: [PaymentHitResponse] }) items!: PaymentHitResponse[];
}

class SearchGroups {
  @ApiPropertyOptional({ type: DoctorGroup, description: 'Absent without doctors.read' }) doctors?: DoctorGroup;
  @ApiPropertyOptional({ type: CaseGroup, description: 'Absent without cases.read' }) cases?: CaseGroup;
  @ApiPropertyOptional({ type: PaymentGroup, description: 'Absent without payments.read' }) payments?: PaymentGroup;
}

export class SearchResponse {
  @ApiProperty({ description: 'The text searched, normalised' }) q!: string;
  @ApiProperty({ type: SearchGroups }) groups!: SearchGroups;
}
