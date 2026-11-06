import { DomainError } from '../errors/domain-error';
import { ParseIdPipe } from './parse-id.pipe';

describe('ParseIdPipe', () => {
  const pipe = new ParseIdPipe();

  it.each([
    ['1', 1],
    ['42', 42],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('accepts %p', (raw, id) => {
    expect(pipe.transform(raw)).toBe(id);
  });

  it.each(['0', '-1', '01', '1.5', '1e3', 'abc', '', '9007199254740993', '99999999999999999999'])(
    'rejects %p with 400',
    (raw) => {
      let error: unknown;
      try {
        pipe.transform(raw);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({ code: 'error.bad_request', status: 400 });
    },
  );
});
