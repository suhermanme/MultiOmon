import type Database from 'better-sqlite3';
import type { AttachmentRepository } from '../../application/ports/repositories';
import {
  createAccountId,
  createAttachmentId,
  createMessageId,
  type AccountId,
  type Attachment,
  type AttachmentId,
  type AttachmentKind,
} from '../../domain';
import { withDatabaseError } from './database-error';

interface AttachmentRow {
  readonly account_id: string;
  readonly id: string;
  readonly message_id: string;
  readonly kind: AttachmentKind;
  readonly media_type: string;
  readonly file_name: string | null;
  readonly size_bytes: number | null;
  readonly local_path: string | null;
  readonly remote_reference: string | null;
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    accountId: createAccountId(row.account_id),
    id: createAttachmentId(row.id),
    messageId: createMessageId(row.message_id),
    kind: row.kind,
    mediaType: row.media_type,
    ...(row.file_name === null ? {} : { fileName: row.file_name }),
    ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
    ...(row.local_path === null ? {} : { localPath: row.local_path }),
    ...(row.remote_reference === null ? {} : { remoteReference: row.remote_reference }),
  };
}

export class SqliteAttachmentRepository implements AttachmentRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  save(attachment: Attachment): void {
    withDatabaseError('save attachment', () => {
      this.#database
        .prepare(
          `INSERT INTO attachments (
             account_id, id, message_id, kind, media_type, file_name,
             size_bytes, local_path, remote_reference
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, id) DO UPDATE SET
             message_id = excluded.message_id,
             kind = excluded.kind,
             media_type = excluded.media_type,
             file_name = excluded.file_name,
             size_bytes = excluded.size_bytes,
             local_path = excluded.local_path,
             remote_reference = excluded.remote_reference`,
        )
        .run(
          attachment.accountId,
          attachment.id,
          attachment.messageId,
          attachment.kind,
          attachment.mediaType,
          attachment.fileName ?? null,
          attachment.sizeBytes ?? null,
          attachment.localPath ?? null,
          attachment.remoteReference ?? null,
        );
    });
  }

  getById(accountId: AccountId, attachmentId: AttachmentId): Attachment | null {
    return withDatabaseError('get attachment', () => {
      const row = this.#database
        .prepare(
          `SELECT account_id, id, message_id, kind, media_type, file_name,
                  size_bytes, local_path, remote_reference
           FROM attachments
           WHERE account_id = ? AND id = ?`,
        )
        .get(accountId, attachmentId) as AttachmentRow | undefined;
      return row ? toAttachment(row) : null;
    });
  }
}
