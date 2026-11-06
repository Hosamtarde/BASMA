import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { IsOptionalNonNull, PageMeta, VersionedPatch } from '../../../shared/http/common.dto';
import { IsAmount } from '../../../shared/money/amount.validators';
import { IsName } from '../../../shared/text/names';

const amountDoc = { description: 'Integer minor units (e.g. agorot)', minimum: 0, example: 15000 };

// ---- Technicians ----

export class CreateTechnicianRequest {
  @ApiProperty({ maxLength: 100 }) @IsName() name!: string;
}

export class UpdateTechnicianRequest extends VersionedPatch {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptionalNonNull() @IsName() name?: string;
  @ApiPropertyOptional() @IsOptionalNonNull() @IsBoolean() active?: boolean;
}

export class TechnicianResponse {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() rowVersion!: number;
}

export class TechnicianPage extends PageMeta {
  @ApiProperty({ type: [TechnicianResponse] }) items!: TechnicianResponse[];
}

// ---- Work types ----

export class CreateWorkTypeRequest {
  @ApiProperty({ maxLength: 100, example: 'ط²ظٹط±ظƒظˆظ†' }) @IsName() name!: string;

  @ApiPropertyOptional({ ...amountDoc, default: 0 })
  @IsOptionalNonNull()
  @IsAmount()
  unitPrice: number = 0;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder: number = 0;
}

export class UpdateWorkTypeRequest extends VersionedPatch {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptionalNonNull() @IsName() name?: string;
  @ApiPropertyOptional(amountDoc) @IsOptionalNonNull() @IsAmount() unitPrice?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
  @ApiPropertyOptional() @IsOptionalNonNull() @IsBoolean() active?: boolean;
}

export class WorkTypeResponse {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty(amountDoc) unitPrice!: number;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty() rowVersion!: number;
}

export class WorkTypePage extends PageMeta {
  @ApiProperty({ type: [WorkTypeResponse] }) items!: WorkTypeResponse[];
}

// ---- Expense categories ----

export class CreateExpenseCategoryRequest {
  @ApiProperty({ maxLength: 100 }) @IsName() name!: string;
}

export class UpdateExpenseCategoryRequest extends VersionedPatch {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptionalNonNull() @IsName() name?: string;
  @ApiPropertyOptional({ description: 'The doctor-refund category cannot be deactivated' })
  @IsOptionalNonNull()
  @IsBoolean()
  active?: boolean;
}

export class ExpenseCategoryResponse {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'System آ«doctor refundآ» category (SPEC آ§5.9)' }) isDoctor!: boolean;
  @ApiProperty() active!: boolean;
  @ApiProperty() rowVersion!: number;
}

export class ExpenseCategoryPage extends PageMeta {
  @ApiProperty({ type: [ExpenseCategoryResponse] }) items!: ExpenseCategoryResponse[];
}
