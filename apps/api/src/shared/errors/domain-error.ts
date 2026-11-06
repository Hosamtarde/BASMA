import { HttpStatus } from '@nestjs/common';
import { TranslationParams } from '../i18n/i18n.service';

/**
 * A business/application error with a stable catalog code. The global filter
 * turns it into `{ error: { code, message, params, correlationId } }`.
 * Params must never contain secrets or personal data beyond what the screen shows.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: HttpStatus,
    readonly params: TranslationParams = {},
    /** Extra machine-readable details (e.g. per-field validation codes). */
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'DomainError';
  }
}
