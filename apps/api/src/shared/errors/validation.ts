import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { DomainError } from './domain-error';

export interface FieldError {
  field: string;
  /** class-validator constraint name, e.g. `isString`, `minLength`, `whitelistValidation`. */
  constraints: string[];
}

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, constraints: Object.keys(e.constraints) }] : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/** Global pipe: whitelist + reject unknown fields (mass assignment), errors mapped to a catalog code. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // Messages are produced from our catalogs, not from class-validator's English text.
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new DomainError('error.validation.failed', HttpStatus.BAD_REQUEST, {}, { fields: flatten(errors) }),
  });
}
