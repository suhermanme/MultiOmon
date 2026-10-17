import type Database from 'better-sqlite3';
import type { ReceiptRepository } from '../../application/ports/repositories';
import {
  createAccountId,
  createMessageId,
  type AccountId,
  type MessageId,
  type Receipt,
  type ReceiptStatus,
} from '../../domain';
import { withDatabaseError } from './database-error';

// Mirrors the CHECK constraint on receipts.status_rank; the rank lets the
// upsert keep the strongest status per (message, recipient) regardless of the
// order in which provider receipt events arrive.
const STATUS_RANK: Record<ReceiptStatus, number> = {
  sent: 0,
  delivered: 1,
  read: 2,
  played: 3,
};

interface ReceiptRow {
  readonly account_id: string;
  readonly message_id: string;
  readonly recipient_remote_id: string;
  readonly status: ReceiptStatus;
  readonly occurred_at: number;
}

function toReceipt(row: ReceiptRow): Receipt {
  return {
    accountId: createAccountId(row.account_id),
    messageId: createMessageId(row.message_id),
    recipientRemoteId: row.recipient_remote_id,
    status: row.status,
    occurredAt: row.occurred_at,
  };
}

export class SqliteReceiptRepository implements ReceiptRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  save(receipt: Receipt): void {
    withDatabaseError('save receipt', () => {
      this.#database
        .prepare(
          `INSERT INTO receipts (
             account_id, message_id, recipient_remote_id, status, status_rank, occurred_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, message_id, recipient_remote_id) DO UPDATE SET
             status = excluded.status,
             status_rank = excluded.status_rank,
             occurred_at = excluded.occurred_at
           WHERE excluded.status_rank > receipts.status_rank`,
        )
        .run(
          receipt.accountId,
          receipt.messageId,
          receipt.recipientRemoteId,
          receipt.status,
          STATUS_RANK[receipt.status],
          receipt.occurredAt,
        );
    });
  }

  listByMessage(accountId: AccountId, messageId: MessageId): readonly Receipt[] {
    return withDatabaseError('list receipts', () =>
      (
        this.#database
          .prepare(
            `SELECT account_id, message_id, recipient_remote_id, status, occurred_at
             FROM receipts
             WHERE account_id = ? AND message_id = ?
             ORDER BY recipient_remote_id`,
          )
          .all(accountId, messageId) as ReceiptRow[]
      ).map(toReceipt),
    );
  }
}
