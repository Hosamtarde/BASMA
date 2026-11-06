import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** OWASP baseline for Argon2id (the library's default algorithm): m=19 MiB, t=2, p=1 (ADR-0004). */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password);
  }

  /** Same cost as a real check, so unknown usernames cannot be detected by response time. */
  async burnTime(password: string): Promise<void> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('hex'));
    await verify(await this.dummyHash, password);
  }
}
