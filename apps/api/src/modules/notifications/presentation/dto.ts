import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MAX_ITEMS_PER_TYPE, NOTIFICATION_PHASES, NOTIFICATION_TYPES } from '../domain/notification-rules';
import type { NotificationPhase, NotificationType } from '../domain/notification-rules';

export class NotificationsQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: MAX_ITEMS_PER_TYPE, description: 'Items listed per type' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = MAX_ITEMS_PER_TYPE;
}

export class NotificationStateRequest {
  @ApiPropertyOptional({
    type: [String],
    minItems: 1,
    maxItems: 200,
    description: 'Keys from GET /notifications; required unless all=true',
  })
  @ValidateIf((o: NotificationStateRequest) => o.all === undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  keys?: string[];

  @ApiPropertyOptional({
    enum: [true],
    description: 'With seen=true: every item of the caller’s feed now (opening the bell). Not with keys or dismissed',
  })
  @IsOptional()
  @Equals(true)
  all?: true;

  @ApiPropertyOptional({ enum: [true], description: 'Mark as read (opening the bell does this)' })
  @IsOptional()
  @Equals(true)
  seen?: true;

  @ApiPropertyOptional({ description: 'true hides the items until they change; false shows them again' })
  @IsOptional()
  @IsBoolean()
  dismissed?: boolean;
}

class NotificationEntityResponse {
  @ApiProperty({ enum: ['case', 'cheque'] }) kind!: 'case' | 'cheque';
  @ApiProperty({ description: 'Case id or cheque id' }) id!: number;
  @ApiPropertyOptional({ enum: ['in', 'out'], description: 'Cheques only' }) direction?: 'in' | 'out';
  @ApiPropertyOptional({ description: 'Cheques only' }) chequeNo?: string;
}

export class NotificationItemResponse {
  @ApiProperty({ example: 'case_due:41:soon:2026-11-12', description: 'Names this item in this phase' }) key!: string;
  @ApiProperty({ enum: NOTIFICATION_TYPES }) type!: NotificationType;
  @ApiProperty({ enum: NOTIFICATION_PHASES }) phase!: NotificationPhase;
  @ApiProperty({ description: 'Expected date, cheque due date or collect date' }) date!: string;
  @ApiProperty({ type: NotificationEntityResponse }) entity!: NotificationEntityResponse;
  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    description: 'Values used in the text (amount in integer minor units)',
  })
  params!: Record<string, string | number>;
  @ApiProperty({ description: 'Rendered in the request language' }) text!: string;
  @ApiProperty() seen!: boolean;
}

export class NotificationGroupResponse {
  @ApiProperty({ enum: NOTIFICATION_TYPES }) type!: NotificationType;
  @ApiProperty({ description: 'Items of this type not hidden (exact)' }) total!: number;
  @ApiProperty() unread!: number;
  @ApiProperty({ type: [NotificationItemResponse] }) items!: NotificationItemResponse[];
}

export class NotificationsResponse {
  @ApiProperty({ description: 'The lab’s today' }) today!: string;
  @ApiProperty() unread!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ type: [NotificationGroupResponse], description: 'One group per type the caller may see' })
  groups!: NotificationGroupResponse[];
}

export class NotificationCountResponse {
  @ApiProperty() unread!: number;
  @ApiProperty() total!: number;
}
