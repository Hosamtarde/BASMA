import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';

/**
 * Route ids: positive safe integers only. Anything else is a 400 — never a database
 * "bigint out of range" (500) from an absurd id such as 99999999999999999999.
 */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = /^[1-9][0-9]{0,15}$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(id)) {
      throw new DomainError('error.bad_request', HttpStatus.BAD_REQUEST);
    }
    return id;
  }
}
