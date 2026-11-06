import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { normalizeOptionalText } from '../text/names';

/** Digits of any script (Arabic-Indic too), spaces, +, -, parentheses. */
export const PHONE_PATTERN = /^[\p{Nd}+\-() ]+$/u;
export const PHONE_MAX_LENGTH = 30;

/** Optional, nullable free text: trimmed; blank or null clears it. */
export const OptionalText = (max: number) =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) => normalizeOptionalText(value)),
    IsOptional(),
    IsString(),
    MaxLength(max),
  );

export const OptionalPhone = () => applyDecorators(OptionalText(PHONE_MAX_LENGTH), Matches(PHONE_PATTERN));
