import { HttpStatus } from '@nestjs/common';
import { DomainError } from './domain-error';

export const notFound = (): DomainError => new DomainError('error.not_found', HttpStatus.NOT_FOUND);

/** Optimistic concurrency: the client edited an outdated version (SPEC §7.8). */
export const staleVersion = (): DomainError =>
  new DomainError('error.concurrency.stale', HttpStatus.CONFLICT);

export const nameTaken = (entity: string, name: string): DomainError =>
  new DomainError(`error.${entity}.name_taken`, HttpStatus.CONFLICT, { name });
