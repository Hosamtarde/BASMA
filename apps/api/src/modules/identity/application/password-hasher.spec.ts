import { PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('uses Argon2id with the OWASP baseline parameters and verifies correctly', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(hasher.verify(hash, 'correct horse battery')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'wrong password!!')).resolves.toBe(false);
  });

  it('burnTime completes without throwing', async () => {
    await expect(hasher.burnTime('anything')).resolves.toBeUndefined();
  });
});

describe('TokenService.hashRefreshToken', () => {
  it('is a deterministic SHA-256 hex digest (the raw token is never stored)', () => {
    const h = TokenService.hashRefreshToken('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
