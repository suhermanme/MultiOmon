import type Database from 'better-sqlite3';
import type { AccountRepository } from '../../application/ports/repositories';
import { createAccountId, type Account, type AccountId } from '../../domain';
import { withDatabaseError } from './database-error';

interface AccountRow {
  readonly id: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly created_at: number;
}

function toAccount(row: AccountRow): Account {
  return {
    id: createAccountId(row.id),
    displayName: row.display_name,
    createdAt: row.created_at,
    ...(row.avatar_url === null ? {} : { avatarUrl: row.avatar_url }),
  };
}

export class SqliteAccountRepository implements AccountRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  save(account: Account): void {
    withDatabaseError('save account', () => {
      this.#database
        .prepare(
          `INSERT INTO accounts (id, display_name, avatar_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             display_name = excluded.display_name,
             avatar_url = excluded.avatar_url,
             updated_at = excluded.updated_at`,
        )
        .run(
          account.id,
          account.displayName,
          account.avatarUrl ?? null,
          account.createdAt,
          Date.now(),
        );
    });
  }

  getById(accountId: AccountId): Account | null {
    return withDatabaseError('get account', () => {
      const row = this.#database
        .prepare('SELECT id, display_name, avatar_url, created_at FROM accounts WHERE id = ?')
        .get(accountId) as AccountRow | undefined;
      return row ? toAccount(row) : null;
    });
  }

  list(): readonly Account[] {
    return withDatabaseError('list accounts', () =>
      (
        this.#database
          .prepare(
            'SELECT id, display_name, avatar_url, created_at FROM accounts ORDER BY created_at, id',
          )
          .all() as AccountRow[]
      ).map(toAccount),
    );
  }

  delete(accountId: AccountId): void {
    withDatabaseError('delete account', () => {
      this.#database.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
    });
  }
}
