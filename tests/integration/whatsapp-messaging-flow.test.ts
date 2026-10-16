import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MessagingService,
  type MessagingProjectionChange,
} from '../../src/application/messaging/messaging-service';
import { MessagingView } from '../../src/application/messaging/messaging-view';
import { createAccountId, type Account } from '../../src/domain';
import { createRepositories, SqliteDatabase } from '../../src/infrastructure/database';
import { WhatsappMessagingProvider } from '../../src/infrastructure/messaging/whatsapp';

describe('whatsapp provider to messaging service integration', { timeout: 10000 }, () => {
  let directory: string;
  let database: SqliteDatabase;
  let authDir: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'multiomon-whatsapp-'));
    authDir = mkdtempSync(join(tmpdir(), 'multiomon-whatsapp-auth-'));
    database = SqliteDatabase.open(join(directory, 'test.sqlite'));
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
    rmSync(authDir, { recursive: true, force: true });
  });

  it('keeps projections empty and emits no change events until a WhatsApp socket is connected', async () => {
    const repositories = createRepositories(database);
    const account: Account = {
      id: createAccountId('wa-account'),
      displayName: 'WhatsApp Account',
      createdAt: 1,
    };
    repositories.accounts.save(account);

    const provider = new WhatsappMessagingProvider(authDir, () => ({}));
    const service = new MessagingService(provider, database, repositories);
    const view = new MessagingView(repositories.chats, repositories.messages);
    const changes: MessagingProjectionChange[] = [];
    const unsubscribe = service.subscribe((change) => changes.push(change));
    const managedSession = service.createAccountSession(account.id);

    // The session should start in idle state
    expect(managedSession.getState().kind).toBe('idle');

    // Without a socket the provider must not project anything
    expect(view.listChats(account.id)).toEqual([]);
    expect(changes).toEqual([]);

    // connection.changed must never surface as a projection change
    await managedSession.disconnect('cleanup');
    expect(changes).toEqual([]);

    unsubscribe();
    service.dispose();
  });

  it('isolates sessions by account', async () => {
    const repositories = createRepositories(database);
    const firstAccountId = createAccountId('first');
    const secondAccountId = createAccountId('second');
    repositories.accounts.save({ id: firstAccountId, displayName: 'First', createdAt: 1 });
    repositories.accounts.save({ id: secondAccountId, displayName: 'Second', createdAt: 2 });

    const provider = new WhatsappMessagingProvider(authDir);
    const service = new MessagingService(provider, database, repositories);

    const first = service.createAccountSession(firstAccountId);
    const second = service.createAccountSession(secondAccountId);

    // Both sessions should be independent
    expect(first.accountId).toBe(firstAccountId);
    expect(second.accountId).toBe(secondAccountId);
    expect(first.getState().kind).toBe('idle');
    expect(second.getState().kind).toBe('idle');

    // Disconnecting one should not affect the other
    await first.disconnect('manual');
    expect(first.getState().kind).toBe('disconnected');
    expect(second.getState().kind).toBe('idle');

    service.dispose();
  });

  it('handles sendText rejection when not connected', async () => {
    const repositories = createRepositories(database);
    const account: Account = {
      id: createAccountId('wa-account'),
      displayName: 'WhatsApp Account',
      createdAt: 1,
    };
    repositories.accounts.save(account);

    const provider = new WhatsappMessagingProvider(authDir);
    const service = new MessagingService(provider, database, repositories);
    service.createAccountSession(account.id);

    // Attempting to send without connection should throw
    await expect(
      service
        .getSession(account.id)
        .sendText({ chatRemoteId: '123@s.whatsapp.net', text: 'hello' }),
    ).rejects.toMatchObject({ code: 'not-connected' });

    service.dispose();
  });
});
