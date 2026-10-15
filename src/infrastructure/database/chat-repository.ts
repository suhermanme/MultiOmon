import type Database from 'better-sqlite3';
import type { ChatRepository } from '../../application/ports/repositories';
import {
  createAccountId,
  createChatId,
  type AccountId,
  type Chat,
  type ChatId,
} from '../../domain';
import { withDatabaseError } from './database-error';

interface ChatRow {
  readonly account_id: string;
  readonly id: string;
  readonly remote_id: string;
  readonly kind: 'direct' | 'group';
  readonly title: string;
  readonly unread_count: number;
  readonly last_activity_at: number | null;
}

function toChat(row: ChatRow): Chat {
  return {
    accountId: createAccountId(row.account_id),
    id: createChatId(row.id),
    remoteId: row.remote_id,
    kind: row.kind,
    title: row.title,
    unreadCount: row.unread_count,
    ...(row.last_activity_at === null ? {} : { lastActivityAt: row.last_activity_at }),
  };
}

const selectChat = `
  SELECT account_id, id, remote_id, kind, title, unread_count, last_activity_at
  FROM chats
`;

export class SqliteChatRepository implements ChatRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  save(chat: Chat): void {
    withDatabaseError('save chat', () => {
      this.#database
        .prepare(
          `INSERT INTO chats (
             account_id, id, remote_id, kind, title, unread_count, last_activity_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, id) DO UPDATE SET
             remote_id = excluded.remote_id,
             kind = excluded.kind,
             title = excluded.title,
             unread_count = excluded.unread_count,
             last_activity_at = excluded.last_activity_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          chat.accountId,
          chat.id,
          chat.remoteId,
          chat.kind,
          chat.title,
          chat.unreadCount,
          chat.lastActivityAt ?? null,
          Date.now(),
        );
    });
  }

  getById(accountId: AccountId, chatId: ChatId): Chat | null {
    return this.#getOne(`${selectChat} WHERE account_id = ? AND id = ?`, accountId, chatId);
  }

  getByRemoteId(accountId: AccountId, remoteId: string): Chat | null {
    return this.#getOne(
      `${selectChat} WHERE account_id = ? AND remote_id = ?`,
      accountId,
      remoteId,
    );
  }

  listByAccount(accountId: AccountId): readonly Chat[] {
    return withDatabaseError('list chats', () =>
      (
        this.#database
          .prepare(
            `${selectChat}
             WHERE account_id = ?
             ORDER BY last_activity_at DESC, id DESC`,
          )
          .all(accountId) as ChatRow[]
      ).map(toChat),
    );
  }

  #getOne(sql: string, ...parameters: readonly string[]): Chat | null {
    return withDatabaseError('get chat', () => {
      const row = this.#database.prepare(sql).get(...parameters) as ChatRow | undefined;
      return row ? toChat(row) : null;
    });
  }
}
