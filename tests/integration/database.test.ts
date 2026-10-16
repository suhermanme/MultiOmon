import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RepositoryBundle } from '../../src/application/ports/repositories';
import {
  createAccountId,
  createAttachmentId,
  createChatId,
  createContactId,
  createMessageId,
  type Account,
  type Chat,
  type Message,
} from '../../src/domain';
import {
  createRepositories,
  DatabaseError,
  getAppliedMigrationVersions,
  migrations,
  SqliteDatabase,
} from '../../src/infrastructure/database';
import { seedMockAccounts } from '../../src/main/bootstrap';

function account(id: string): Account {
  return { id: createAccountId(id), displayName: `Account ${id}`, createdAt: 100 };
}

function chat(accountValue: Account, id = 'chat', remoteId = 'chat@remote'): Chat {
  return {
    id: createChatId(id),
    accountId: accountValue.id,
    remoteId,
    kind: 'direct',
    title: `Chat ${id}`,
    unreadCount: 0,
    lastActivityAt: 500,
  };
}

function message(
  accountValue: Account,
  chatValue: Chat,
  id: string,
  remoteId: string,
  sentAt: number,
  text = id,
): Message {
  return {
    id: createMessageId(id),
    accountId: accountValue.id,
    chatId: chatValue.id,
    remoteId,
    direction: 'incoming',
    sentAt,
    content: { kind: 'text', text },
  };
}

describe('SQLite persistence', () => {
  let directory: string;
  let filePath: string;
  let database: SqliteDatabase;
  let repositories: RepositoryBundle;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'multiomon-database-'));
    filePath = join(directory, 'multiomon.sqlite');
    database = SqliteDatabase.open(filePath);
    repositories = createRepositories(database);
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates and reapplies versioned migrations safely', () => {
    expect(getAppliedMigrationVersions(database.connection)).toEqual([1, 2, 3, 4, 5, 6]);

    database.close();
    database = SqliteDatabase.open(filePath);

    expect(getAppliedMigrationVersions(database.connection)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('upgrades an existing version-one database without destroying its data', () => {
    const legacyPath = join(directory, 'legacy.sqlite');
    const legacyConnection = new BetterSqlite3(legacyPath);
    legacyConnection.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `);
    legacyConnection.exec(migrations[0]!.sql);
    legacyConnection
      .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(1, migrations[0]!.name, 1);
    legacyConnection
      .prepare(
        'INSERT INTO accounts (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run('legacy-account', 'Legacy account', 1, 1);
    legacyConnection
      .prepare(
        `INSERT INTO chats
          (account_id, id, remote_id, kind, title, unread_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-account', 'legacy-chat', 'legacy-remote', 'direct', 'Legacy chat', 0, 1);
    legacyConnection
      .prepare(
        `INSERT INTO chats
          (account_id, id, remote_id, kind, title, unread_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-account', 'control-chat', '180900000000001', 'direct', '180900000000001', 0, 1);
    const insertLegacyMessage = legacyConnection.prepare(
      `INSERT INTO messages
        (account_id, id, chat_id, remote_id, direction, sent_at, content_kind, text_content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertLegacyMessage.run(
      'legacy-account',
      'control-placeholder',
      'control-chat',
      'control-placeholder',
      'outgoing',
      1,
      'system',
      '[Unsupported message type]',
    );
    insertLegacyMessage.run(
      'legacy-account',
      'real-message',
      'legacy-chat',
      'real-message',
      'incoming',
      2,
      'text',
      'Keep me',
    );
    legacyConnection.close();

    const upgraded = SqliteDatabase.open(legacyPath);
    const upgradedRepositories = createRepositories(upgraded);

    expect(getAppliedMigrationVersions(upgraded.connection)).toEqual([1, 2, 3, 4, 5, 6]);
    const legacyAccount = upgradedRepositories.accounts.list()[0];
    expect(legacyAccount?.displayName).toBe('Legacy account');
    expect(legacyAccount?.phoneNumber).toBeUndefined();
    expect(
      upgradedRepositories.chats.getById(
        createAccountId('legacy-account'),
        createChatId('control-chat'),
      ),
    ).toMatchObject({
      remoteId: '180900000000001@lid',
      title: 'WhatsApp contact',
    });
    expect(
      upgraded.connection
        .prepare('SELECT id FROM messages WHERE account_id = ? ORDER BY id')
        .all('legacy-account'),
    ).toEqual([{ id: 'real-message' }]);
    upgraded.close();
  });

  it('persists accounts, contacts, chats, and messages across a full reopen', () => {
    const savedAccount = account('persistent');
    const savedChat = chat(savedAccount);
    const savedMessage = message(savedAccount, savedChat, 'message', 'remote-message', 700);

    repositories.accounts.save(savedAccount);
    repositories.contacts.save({
      id: createContactId('contact'),
      accountId: savedAccount.id,
      remoteId: 'contact@remote',
      displayName: 'Persistent Contact',
      phoneNumber: '+620000000',
    });
    repositories.chats.save(savedChat);
    repositories.messages.insert(savedMessage);

    const accountWithPhone: Account = {
      ...savedAccount,
      id: createAccountId('persistent-phone'),
      displayName: 'Persistent Phone',
      phoneNumber: '+33612345678',
    };
    repositories.accounts.save(accountWithPhone);

    database.close();
    database = SqliteDatabase.open(filePath);
    repositories = createRepositories(database);

    expect(repositories.accounts.getById(savedAccount.id)).toEqual(savedAccount);
    expect(repositories.accounts.getById(accountWithPhone.id)).toEqual(accountWithPhone);
    expect(repositories.accounts.getById(savedAccount.id)?.phoneNumber).toBeUndefined();
    expect(repositories.contacts.listByAccount(savedAccount.id)).toHaveLength(1);
    expect(repositories.chats.getById(savedAccount.id, savedChat.id)).toEqual(savedChat);
    expect(repositories.messages.getById(savedAccount.id, savedMessage.id)).toEqual(savedMessage);
  });

  it('restores mock accounts without reseeding duplicates', () => {
    seedMockAccounts(database, repositories);
    expect(repositories.accounts.list()).toHaveLength(3);

    database.close();
    database = SqliteDatabase.open(filePath);
    repositories = createRepositories(database);
    seedMockAccounts(database, repositories);

    expect(repositories.accounts.list()).toHaveLength(3);
    for (const restoredAccount of repositories.accounts.list()) {
      expect(repositories.contacts.listByAccount(restoredAccount.id)).toHaveLength(0);
      expect(repositories.chats.listPage(restoredAccount.id, 1).items).toHaveLength(0);
    }
  });

  it('isolates identical internal and remote IDs across accounts', () => {
    const firstAccount = account('first');
    const secondAccount = account('second');
    const firstChat = chat(firstAccount, 'same-chat', 'same-remote-chat');
    const secondChat = chat(secondAccount, 'same-chat', 'same-remote-chat');
    repositories.accounts.save(firstAccount);
    repositories.accounts.save(secondAccount);
    repositories.chats.save(firstChat);
    repositories.chats.save(secondChat);
    repositories.messages.insert(
      message(firstAccount, firstChat, 'same-message', 'same-remote-message', 100, 'first'),
    );
    repositories.messages.insert(
      message(secondAccount, secondChat, 'same-message', 'same-remote-message', 100, 'second'),
    );

    expect(repositories.chats.getByRemoteId(firstAccount.id, 'same-remote-chat')?.accountId).toBe(
      firstAccount.id,
    );
    expect(
      repositories.messages.getByRemoteId(firstAccount.id, 'same-remote-message')?.content,
    ).toEqual({ kind: 'text', text: 'first' });
    expect(
      repositories.messages.getByRemoteId(secondAccount.id, 'same-remote-message')?.content,
    ).toEqual({ kind: 'text', text: 'second' });
  });

  it('inserts repeated protocol messages idempotently', () => {
    const savedAccount = account('deduplication');
    const savedChat = chat(savedAccount);
    const savedMessage = message(savedAccount, savedChat, 'message', 'stable-remote-id', 100);
    repositories.accounts.save(savedAccount);
    repositories.chats.save(savedChat);

    expect(repositories.messages.insert(savedMessage)).toBe(true);
    expect(repositories.messages.insert(savedMessage)).toBe(false);
    expect(repositories.messages.listPage(savedAccount.id, savedChat.id, 20).items).toHaveLength(1);
  });

  it('persists attachment metadata separately from message rows', () => {
    const savedAccount = account('media');
    const savedChat = chat(savedAccount);
    const messageId = createMessageId('media-message');
    const attachmentId = createAttachmentId('media-attachment');
    repositories.accounts.save(savedAccount);
    repositories.chats.save(savedChat);
    repositories.messages.insert({
      ...message(savedAccount, savedChat, messageId, 'remote-media', 100),
      id: messageId,
      content: { kind: 'media', attachmentId, caption: 'A photo' },
    });
    repositories.attachments.save({
      id: attachmentId,
      accountId: savedAccount.id,
      messageId,
      kind: 'image',
      mediaType: 'image/jpeg',
      fileName: 'photo.jpg',
      sizeBytes: 42,
      remoteReference: 'provider-ref',
    });

    expect(repositories.attachments.getById(savedAccount.id, attachmentId)).toEqual({
      id: attachmentId,
      accountId: savedAccount.id,
      messageId,
      kind: 'image',
      mediaType: 'image/jpeg',
      fileName: 'photo.jpg',
      sizeBytes: 42,
      remoteReference: 'provider-ref',
    });
  });

  it('paginates deterministically without gaps or duplicates', () => {
    const savedAccount = account('pagination');
    const savedChat = chat(savedAccount);
    repositories.accounts.save(savedAccount);
    repositories.chats.save(savedChat);

    for (let index = 1; index <= 5; index += 1) {
      repositories.messages.insert(
        message(savedAccount, savedChat, `message-${index}`, `remote-${index}`, 100),
      );
    }

    const first = repositories.messages.listPage(savedAccount.id, savedChat.id, 2);
    expect(first.items.map(({ id }) => id)).toEqual(['message-5', 'message-4']);
    expect(first.nextCursor).not.toBeNull();
    const second = repositories.messages.listPage(
      savedAccount.id,
      savedChat.id,
      2,
      first.nextCursor ?? undefined,
    );
    expect(second.items.map(({ id }) => id)).toEqual(['message-3', 'message-2']);
    const third = repositories.messages.listPage(
      savedAccount.id,
      savedChat.id,
      2,
      second.nextCursor ?? undefined,
    );
    expect(third.items.map(({ id }) => id)).toEqual(['message-1']);
    expect(third.nextCursor).toBeNull();
  });

  it('pages chats newest-first with a keyset cursor and id tiebreak', () => {
    const savedAccount = account('chat-pages');
    repositories.accounts.save(savedAccount);
    const otherAccount = account('chat-pages-other');
    repositories.accounts.save(otherAccount);
    repositories.chats.save({ ...chat(savedAccount, 'old', 'old@remote'), lastActivityAt: 300 });
    repositories.chats.save({
      ...chat(savedAccount, 'tie-b', 'tie-b@remote'),
      lastActivityAt: 700,
    });
    repositories.chats.save({
      ...chat(savedAccount, 'tie-a', 'tie-a@remote'),
      lastActivityAt: 700,
    });
    repositories.chats.save({ ...chat(savedAccount, 'mid', 'mid@remote'), lastActivityAt: 500 });
    repositories.chats.save({
      id: createChatId('null-activity'),
      accountId: savedAccount.id,
      remoteId: 'null@remote',
      kind: 'direct',
      title: 'Chat null-activity',
      unreadCount: 0,
    });
    repositories.chats.save({
      ...chat(otherAccount, 'other', 'other@remote'),
      lastActivityAt: 900,
    });

    const firstPage = repositories.chats.listPage(savedAccount.id, 2);
    expect(firstPage.items.map(({ id }) => id)).toEqual(['tie-b', 'tie-a']);
    expect(firstPage.nextCursor).toEqual({ lastActivityAt: 700, chatId: 'tie-a' });

    const secondPage = repositories.chats.listPage(
      savedAccount.id,
      2,
      firstPage.nextCursor ?? undefined,
    );
    expect(secondPage.items.map(({ id }) => id)).toEqual(['mid', 'old']);
    expect(secondPage.nextCursor).toEqual({ lastActivityAt: 300, chatId: 'old' });

    const thirdPage = repositories.chats.listPage(
      savedAccount.id,
      2,
      secondPage.nextCursor ?? undefined,
    );
    expect(thirdPage.items.map(({ id }) => id)).toEqual(['null-activity']);
    expect(thirdPage.nextCursor).toBeNull();
  });

  it('rejects chat page limits outside the supported range', () => {
    const savedAccount = account('chat-page-limits');
    repositories.accounts.save(savedAccount);

    expect(() => repositories.chats.listPage(savedAccount.id, 0)).toThrow(RangeError);
    expect(() => repositories.chats.listPage(savedAccount.id, 201)).toThrow(RangeError);
    expect(() => repositories.chats.listPage(savedAccount.id, 1.5)).toThrow(RangeError);
  });

  it('rolls back all writes when a transaction fails', () => {
    const rolledBackAccount = account('rollback');

    expect(() =>
      database.runInTransaction(() => {
        repositories.accounts.save(rolledBackAccount);
        throw new Error('stop transaction');
      }),
    ).toThrow(DatabaseError);
    expect(repositories.accounts.getById(rolledBackAccount.id)).toBeNull();
  });
});
