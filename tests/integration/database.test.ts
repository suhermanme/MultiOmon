import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RepositoryBundle } from '../../src/application/ports/repositories';
import {
  createAccountId,
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
import { seedMockProjection } from '../../src/main/mock-accounts';

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
    expect(getAppliedMigrationVersions(database.connection)).toEqual([1, 2]);

    database.close();
    database = SqliteDatabase.open(filePath);

    expect(getAppliedMigrationVersions(database.connection)).toEqual([1, 2]);
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
    legacyConnection.close();

    const upgraded = SqliteDatabase.open(legacyPath);
    const upgradedRepositories = createRepositories(upgraded);

    expect(getAppliedMigrationVersions(upgraded.connection)).toEqual([1, 2]);
    expect(upgradedRepositories.accounts.list().map(({ displayName }) => displayName)).toEqual([
      'Legacy account',
    ]);
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

    database.close();
    database = SqliteDatabase.open(filePath);
    repositories = createRepositories(database);

    expect(repositories.accounts.getById(savedAccount.id)).toEqual(savedAccount);
    expect(repositories.contacts.listByAccount(savedAccount.id)).toHaveLength(1);
    expect(repositories.chats.getById(savedAccount.id, savedChat.id)).toEqual(savedChat);
    expect(repositories.messages.getById(savedAccount.id, savedMessage.id)).toEqual(savedMessage);
  });

  it('restores the application mock projection without reseeding duplicates', () => {
    seedMockProjection(database, repositories);
    expect(repositories.accounts.list()).toHaveLength(3);

    database.close();
    database = SqliteDatabase.open(filePath);
    repositories = createRepositories(database);
    seedMockProjection(database, repositories);

    expect(repositories.accounts.list()).toHaveLength(3);
    for (const restoredAccount of repositories.accounts.list()) {
      expect(repositories.contacts.listByAccount(restoredAccount.id)).toHaveLength(1);
      expect(repositories.chats.listByAccount(restoredAccount.id)).toHaveLength(1);
      const restoredChat = repositories.chats.listByAccount(restoredAccount.id)[0]!;
      expect(
        repositories.messages.listPage(restoredAccount.id, restoredChat.id, 10).items,
      ).toHaveLength(1);
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
