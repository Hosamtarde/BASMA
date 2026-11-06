import { applyDecorators } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_AMOUNT_MINOR } from './limits';

/** A non-negative amount in integer minor units (prices). Floats and strings are rejected. */
export const IsAmount = () => applyDecorators(IsInt(), Min(0), Max(MAX_AMOUNT_MINOR));

/** A signed amount in integer minor units (opening balances). */
export const IsSignedAmount = () => applyDecorators(IsInt(), Min(-MAX_AMOUNT_MINOR), Max(MAX_AMOUNT_MINOR));
