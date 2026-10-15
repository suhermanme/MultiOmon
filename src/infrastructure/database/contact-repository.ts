import type Database from 'better-sqlite3';
import type { ContactRepository } from '../../application/ports/repositories';
import {
  createAccountId,
  createContactId,
  type AccountId,
  type Contact,
  type ContactId,
} from '../../domain';
import { withDatabaseError } from './database-error';

interface ContactRow {
  readonly account_id: string;
  readonly id: string;
  readonly remote_id: string;
  readonly display_name: string;
  readonly phone_number: string | null;
  readonly avatar_url: string | null;
}

function toContact(row: ContactRow): Contact {
  return {
    accountId: createAccountId(row.account_id),
    id: createContactId(row.id),
    remoteId: row.remote_id,
    displayName: row.display_name,
    ...(row.phone_number === null ? {} : { phoneNumber: row.phone_number }),
    ...(row.avatar_url === null ? {} : { avatarUrl: row.avatar_url }),
  };
}

const selectContact = `
  SELECT account_id, id, remote_id, display_name, phone_number, avatar_url
  FROM contacts
`;

export class SqliteContactRepository implements ContactRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  save(contact: Contact): void {
    withDatabaseError('save contact', () => {
      this.#database
        .prepare(
          `INSERT INTO contacts (
             account_id, id, remote_id, display_name, phone_number, avatar_url, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, id) DO UPDATE SET
             remote_id = excluded.remote_id,
             display_name = excluded.display_name,
             phone_number = excluded.phone_number,
             avatar_url = excluded.avatar_url,
             updated_at = excluded.updated_at`,
        )
        .run(
          contact.accountId,
          contact.id,
          contact.remoteId,
          contact.displayName,
          contact.phoneNumber ?? null,
          contact.avatarUrl ?? null,
          Date.now(),
        );
    });
  }

  getById(accountId: AccountId, contactId: ContactId): Contact | null {
    return this.#getOne(`${selectContact} WHERE account_id = ? AND id = ?`, accountId, contactId);
  }

  getByRemoteId(accountId: AccountId, remoteId: string): Contact | null {
    return this.#getOne(
      `${selectContact} WHERE account_id = ? AND remote_id = ?`,
      accountId,
      remoteId,
    );
  }

  listByAccount(accountId: AccountId): readonly Contact[] {
    return withDatabaseError('list contacts', () =>
      (
        this.#database
          .prepare(
            `${selectContact}
             WHERE account_id = ?
             ORDER BY display_name COLLATE NOCASE, id`,
          )
          .all(accountId) as ContactRow[]
      ).map(toContact),
    );
  }

  #getOne(sql: string, ...parameters: readonly string[]): Contact | null {
    return withDatabaseError('get contact', () => {
      const row = this.#database.prepare(sql).get(...parameters) as ContactRow | undefined;
      return row ? toContact(row) : null;
    });
  }
}
