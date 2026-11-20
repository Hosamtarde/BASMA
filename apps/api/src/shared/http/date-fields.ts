import { applyDecorators } from '@nestjs/common';
import { IsString, ValidateBy } from 'class-validator';
import { isCalendarDate } from '../time/lab-date';

/** A real calendar date as YYYY-MM-DD (business dates are DATE, SPEC §6). */
export const IsDateOnly = () =>
  applyDecorators(
    IsString(),
    ValidateBy({
      name: 'isDateOnly',
      validator: { validate: (value: unknown) => typeof value === 'string' && isCalendarDate(value) },
    }),
  );

/** Required, but may be null (a value that can be removed): a calendar date or null, never missing. */
export const IsDateOnlyOrNull = () =>
  ValidateBy({
    name: 'isDateOnlyOrNull',
    validator: {
      validate: (value: unknown) => value === null || (typeof value === 'string' && isCalendarDate(value)),
    },
  });
