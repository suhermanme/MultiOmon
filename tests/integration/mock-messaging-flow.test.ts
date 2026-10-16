import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingService } from '../../src/application/messaging/messaging-service';
import { MessagingView } from '../../src/application/messaging/messaging-view';
import { createAccountId, createChatId, type Account } from '../../src/domain';
import { createRepositories, SqliteDatabase } from '../../src/infrastructure/database';
import { MockMessagingProvider } from '../../src/infrastructure/messaging/mock';

describe('mock provider to renderer projection flow', () => {
  let directory: string;
  let database: SqliteDatabase;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'multiomon-messaging-'));
    database = SqliteDatabase.open(join(directory, 'multiomon.sqlite'));
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('normalizes provider events, persists them idempotently, and exposes DTOs', async () => {
    const repositories = createRepositories(database);
    const account: Account = {
      id: createAccountId('flow-account'),
      displayName: 'Flow account',
      createdAt: 1,
    };
    repositories.accounts.save(account);
    const provider = new MockMessagingProvider(() => ({
      history: {
        chats: [
          {
            accountId: account.id,
            remoteId: 'friend@remote',
            kind: 'direct',
            title: 'Friend',
            unreadCount: 1,
            lastActivityAt: 100,
          },
        ],
        messages: [
          {
            accountId: account.id,
            remoteId: 'incoming-1',
            chatRemoteId: 'friend@remote',
            direction: 'incoming',
            sentAt: 100,
            content: { kind: 'text', text: 'Hello from the provider' },
          },
        ],
      },
      now: () => 200,
    }));
    const service = new MessagingService(provider, database, repositories);
    const view = new MessagingView(repositories.chats, repositories.messages);
    const changes = vi.fn();
    service.subscribe(changes);
    const managedSession = service.createAccountSession(account.id);

    await managedSession.connect();
    expect(view.listChats(account.id).items[0]).toMatchObject({
      title: 'Friend',
      unreadCount: 1,
      lastActivityAt: 100,
    });
    await provider.getSession(account.id).sendText({
      chatRemoteId: 'friend@remote',
      text: 'Hello back',
    });
    provider.getSession(account.id).simulateIncomingMessage({
      remoteId: 'incoming-1',
      chatRemoteId: 'friend@remote',
      sentAt: 100,
      content: { kind: 'text', text: 'Duplicate delivery' },
    });

    const chats = view.listChats(account.id);
    expect(chats.items).toHaveLength(1);
    expect(chats.items[0]).toMatchObject({ title: 'Friend', accountId: account.id });
    const messages = view.listMessages(account.id, createChatId(chats.items[0]!.id));
    expect(messages.items.map(({ content }) => content)).toEqual([
      { kind: 'text', text: 'Hello from the provider' },
      { kind: 'text', text: 'Hello back' },
    ]);
    // chat.upserted (seed) + message.upserted (seed) + message.upserted (send) +
    // chat.upserted (send) + chat.upserted (incoming delta); the duplicate
    // incoming message is idempotent and yields no change.
    expect(changes).toHaveBeenCalledTimes(5);
    expect(managedSession.getState().kind).toBe('connected');
    service.dispose();
  });

  it('keeps simultaneous provider sessions and projections isolated by account', async () => {
    const repositories = createRepositories(database);
    const firstAccountId = createAccountId('first');
    const secondAccountId = createAccountId('second');
    repositories.accounts.save({ id: firstAccountId, displayName: 'First', createdAt: 1 });
    repositories.accounts.save({ id: secondAccountId, displayName: 'Second', createdAt: 2 });
    const provider = new MockMessagingProvider();
    const service = new MessagingService(provider, database, repositories);
    const first = service.createAccountSession(firstAccountId);
    const second = service.createAccountSession(secondAccountId);
    await Promise.all([first.connect(), second.connect()]);

    provider.getSession(firstAccountId).simulateChat({
      remoteId: 'same@remote',
      kind: 'direct',
      title: 'First chat',
      unreadCount: 0,
    });
    provider.getSession(secondAccountId).simulateChat({
      remoteId: 'same@remote',
      kind: 'direct',
      title: 'Second chat',
      unreadCount: 0,
    });

    expect(repositories.chats.listPage(firstAccountId, 1).items[0]?.title).toBe('First chat');
    expect(repositories.chats.listPage(secondAccountId, 1).items[0]?.title).toBe('Second chat');
    await first.disconnect('first-only');
    expect(first.getState().kind).toBe('disconnected');
    expect(second.getState().kind).toBe('connected');
    service.dispose();
  });
});
