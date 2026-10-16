import type Database from 'better-sqlite3';
import type {
  MessagePageCursor,
  MessageRepository,
  Page,
} from '../../application/ports/repositories';
import {
  createAccountId,
  createAttachmentId,
  createChatId,
  createMessageId,
  type AccountId,
  type ChatId,
  type Message,
  type MessageContent,
  type MessageId,
} from '../../domain';
import { withDatabaseError } from './database-error';

interface MessageRow {
  readonly account_id: string;
  readonly id: string;
  readonly chat_id: string;
  readonly remote_id: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly sender_remote_id: string | null;
  readonly sent_at: number;
  readonly content_kind: 'text' | 'media' | 'system';
  readonly text_content: string | null;
  readonly attachment_id: string | null;
  readonly caption: string | null;
  readonly reply_to_message_id: string | null;
  readonly edited_at: number | null;
  readonly deleted_at: number | null;
}

interface PersistedContent {
  readonly kind: MessageContent['kind'];
  readonly text: string | null;
  readonly attachmentId: string | null;
  readonly caption: string | null;
}

function toPersistedContent(content: MessageContent): PersistedContent {
  switch (content.kind) {
    case 'text':
      return { kind: content.kind, text: content.text, attachmentId: null, caption: null };
    case 'media':
      return {
        kind: content.kind,
        text: null,
        attachmentId: content.attachmentId,
        caption: content.caption ?? null,
      };
    case 'system':
      return { kind: content.kind, text: content.text, attachmentId: null, caption: null };
  }
}

function toMessageContent(row: MessageRow): MessageContent {
  switch (row.content_kind) {
    case 'text':
      return { kind: 'text', text: row.text_content ?? '' };
    case 'media':
      if (row.attachment_id === null) throw new Error('Media message is missing attachment ID');
      return {
        kind: 'media',
        attachmentId: createAttachmentId(row.attachment_id),
        ...(row.caption === null ? {} : { caption: row.caption }),
      };
    case 'system':
      return { kind: 'system', text: row.text_content ?? '' };
  }
}

function toMessage(row: MessageRow): Message {
  return {
    accountId: createAccountId(row.account_id),
    id: createMessageId(row.id),
    chatId: createChatId(row.chat_id),
    remoteId: row.remote_id,
    direction: row.direction,
    sentAt: row.sent_at,
    content: toMessageContent(row),
    ...(row.sender_remote_id === null ? {} : { senderRemoteId: row.sender_remote_id }),
    ...(row.reply_to_message_id === null
      ? {}
      : { replyToMessageId: createMessageId(row.reply_to_message_id) }),
    ...(row.edited_at === null ? {} : { editedAt: row.edited_at }),
    ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
  };
}

const selectMessage = `
  SELECT
    account_id, id, chat_id, remote_id, direction, sender_remote_id, sent_at,
    content_kind, text_content, attachment_id, caption, reply_to_message_id,
    edited_at, deleted_at
  FROM messages
`;

export class SqliteMessageRepository implements MessageRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  insert(message: Message): boolean {
    return withDatabaseError('insert message', () => {
      const content = toPersistedContent(message.content);
      const result = this.#database
        .prepare(
          `INSERT INTO messages (
             account_id, id, chat_id, remote_id, direction, sender_remote_id, sent_at,
             content_kind, text_content, attachment_id, caption, reply_to_message_id,
             edited_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, remote_id) DO NOTHING`,
        )
        .run(
          message.accountId,
          message.id,
          message.chatId,
          message.remoteId,
          message.direction,
          message.senderRemoteId ?? null,
          message.sentAt,
          content.kind,
          content.text,
          content.attachmentId,
          content.caption,
          message.replyToMessageId ?? null,
          message.editedAt ?? null,
          message.deletedAt ?? null,
        );
      return result.changes === 1;
    });
  }

  getById(accountId: AccountId, messageId: MessageId): Message | null {
    return this.#getOne(`${selectMessage} WHERE account_id = ? AND id = ?`, accountId, messageId);
  }

  getByRemoteId(accountId: AccountId, remoteId: string): Message | null {
    return this.#getOne(
      `${selectMessage} WHERE account_id = ? AND remote_id = ?`,
      accountId,
      remoteId,
    );
  }

  getOldestByChat(accountId: AccountId, chatId: ChatId): Message | null {
    return this.#getOne(
      `${selectMessage}
       WHERE account_id = ? AND chat_id = ?
       ORDER BY sent_at ASC, id ASC
       LIMIT 1`,
      accountId,
      chatId,
    );
  }

  listPage(
    accountId: AccountId,
    chatId: ChatId,
    limit: number,
    cursor?: MessagePageCursor,
  ): Page<Message, MessagePageCursor> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new RangeError('Message page limit must be an integer between 1 and 200');
    }

    return withDatabaseError('list message page', () => {
      const rows = cursor
        ? (this.#database
            .prepare(
              `${selectMessage}
               WHERE account_id = ? AND chat_id = ?
                 AND (sent_at < ? OR (sent_at = ? AND id < ?))
               ORDER BY sent_at DESC, id DESC
               LIMIT ?`,
            )
            .all(
              accountId,
              chatId,
              cursor.sentAt,
              cursor.sentAt,
              cursor.messageId,
              limit + 1,
            ) as MessageRow[])
        : (this.#database
            .prepare(
              `${selectMessage}
               WHERE account_id = ? AND chat_id = ?
               ORDER BY sent_at DESC, id DESC
               LIMIT ?`,
            )
            .all(accountId, chatId, limit + 1) as MessageRow[]);

      const hasNextPage = rows.length > limit;
      const items = rows.slice(0, limit).map(toMessage);
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasNextPage && last ? { sentAt: last.sentAt, messageId: last.id } : null,
      };
    });
  }

  #getOne(sql: string, ...parameters: readonly string[]): Message | null {
    return withDatabaseError('get message', () => {
      const row = this.#database.prepare(sql).get(...parameters) as MessageRow | undefined;
      return row ? toMessage(row) : null;
    });
  }
}
