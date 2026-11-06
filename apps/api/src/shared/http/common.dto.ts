import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, ValidateIf } from 'class-validator';

/**
 * The field may be omitted, but if present it must pass validation — `null` included.
 * (`@IsOptional()` would let `null` through to a NOT NULL column.)
 */
export const IsOptionalNonNull = () => ValidateIf((_object: unknown, value: unknown) => value !== undefined);

/** Base of every PATCH on a mutable aggregate: the version the client edited (SPEC §7.8). */
export class VersionedPatch {
  @ApiProperty({ description: 'rowVersion from the last read; outdated → 409 error.concurrency.stale' })
  @IsInt()
  @Min(1)
  rowVersion!: number;
}

export class DeleteResponse {
  @ApiProperty({
    enum: ['deleted', 'deactivated'],
    description: 'deleted if never used, otherwise deactivated (kept for history)',
  })
  outcome!: 'deleted' | 'deactivated';
}

export class PageMeta {
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}
