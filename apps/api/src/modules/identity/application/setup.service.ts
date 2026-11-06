import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { DB } from '../../../shared/db/database';
import type { Database } from '../../../shared/db/database';
import { DomainError } from '../../../shared/errors/domain-error';
import { OWNER_ROLE } from '../domain/permissions';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { PasswordHasher } from './password-hasher';

@Injectable()
export class SetupService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: IdentityRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditWriter,
  ) {}

  async isSetupRequired(): Promise<boolean> {
    return !(await this.repo.anyUserExists(this.db));
  }

  /**
   * First-run owner creation. Locks itself: works only while no user exists.
   * The advisory lock + check inside one transaction prevents two concurrent setups.
   */
  async createOwner(username: string, password: string): Promise<{ id: number; username: string }> {
    const passwordHash = await this.hasher.hash(password);
    return this.db.transaction(async (tx) => {
      await this.repo.lockSetup(tx);
      if (await this.repo.anyUserExists(tx)) {
        throw new DomainError('error.setup.already_done', HttpStatus.CONFLICT);
      }
      const id = await this.repo.insertUser(tx, username, passwordHash);
      await this.repo.assignRole(tx, id, OWNER_ROLE);
      await this.audit.write(tx, {
        userId: id,
        action: 'setup.completed',
        entity: 'user',
        entityId: id,
        params: { username },
      });
      return { id, username };
    });
  }
}
