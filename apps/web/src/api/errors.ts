import type { components } from './schema.gen';

export type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
export type ErrorBody = components['schemas']['ErrorBody'];
export type FieldError = components['schemas']['FieldError'];

/** What the UI does with a failed request (approved F0 error table). */
export type ErrorKind =
  | 'validation' // 400: inline field messages
  | 'unauthenticated' // 401: one silent refresh, then back to login
  | 'forbidden' // 403: dedicated page
  | 'notFound' // 404: dedicated page
  | 'stale' // 409 error.concurrency.stale: "changed elsewhere" dialog with reload
  | 'conflict' // other 409 business rules: the server's message
  | 'rateLimited' // 429: toast
  | 'server' // 5xx: server message + copyable correlation id
  | 'other';

/** A response with the API error envelope. `message` is already localized by the server. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly params: ErrorBody['params'];
  readonly correlationId: string;
  readonly fields: FieldError[];

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.params = body.params;
    this.correlationId = body.correlationId;
    this.fields = body.details?.fields ?? [];
  }

  get kind(): ErrorKind {
    if (this.status === 400) return 'validation';
    if (this.status === 401) return 'unauthenticated';
    if (this.status === 403) return 'forbidden';
    if (this.status === 404) return 'notFound';
    if (this.status === 409) return this.code === 'error.concurrency.stale' ? 'stale' : 'conflict';
    if (this.status === 429) return 'rateLimited';
    if (this.status >= 500) return 'server';
    return 'other';
  }
}

/** The API could not be reached at all (service stopped, port closed). */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('network', { cause });
    this.name = 'NetworkError';
  }
}

const isEnvelope = (value: unknown): value is ErrorEnvelope =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ErrorEnvelope).error?.code === 'string' &&
  typeof (value as ErrorEnvelope).error?.message === 'string';

/** Builds the error for a non-2xx response; a body without the envelope still gets a stable code. */
export function toApiError(status: number, body: unknown, fallbackMessage: string): ApiError {
  if (isEnvelope(body)) return new ApiError(status, body.error);
  return new ApiError(status, {
    code: status >= 500 ? 'error.internal' : 'error.unknown',
    message: fallbackMessage,
    params: {},
    correlationId: 'unknown',
  });
}
