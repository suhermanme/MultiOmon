import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingService } from '../../src/application/messaging/messaging-service';
import type { MediaFileStore } from '../../src/application/ports/media-file-store';
import type {
  HistoryRequest,
  MessagingEvent,
  MessagingEventListener,
  MessagingProvider,
  MessagingSession,
  ProviderChat,
  ProviderConnectionState,
  ProviderMessage,
  SendTextRequest,
  Unsubscribe,
} from '../../src/application/ports/messaging-provider';
import type { RepositoryBundle } from '../../src/application/ports/repositories';
import { createAccountId, type Account, type AccountId, type AttachmentId } from '../../src/domain';
import { createRepositories, SqliteDatabase } from '../../src/infrastructure/database';

class FakeMessagingSession implements MessagingSession {
  readonly #listeners = new Set<MessagingEventListener>();
  readonly historyRequests: HistoryRequest[] = [];
  readonly mediaRequests: string[] = [];

  constructor(readonly accountId: AccountId) {}

  getConnectionState(): ProviderConnectionState {
    return { kind: 'connected', changedAt: 1, connectedAt: 1 };
  }
  startPairing(): Promise<void> {
    return Promise.resolve();
  }
  connect(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  logout(): Promise<void> {
    return Promise.resolve();
  }
  sendText(request: SendTextRequest): Promise<ProviderMessage> {
    return Promise.resolve({
      accountId: this.accountId,
      remoteId: `sent-${request.text}`,
      chatRemoteId: request.chatRemoteId,
      direction: 'outgoing',
      sentAt: 1,
      content: { kind: 'text', text: request.text },
    });
  }
  requestHistory(request: HistoryRequest): Promise<void> {
    this.historyRequests.push(request);
    return Promise.resolve();
  }
  downloadMedia(remoteReference: string): Promise<Uint8Array> {
    this.mediaRequests.push(remoteReference);
    return Promise.resolve(new TextEncoder().encode(remoteReference));
  }
  subscribe(listener: MessagingEventListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  dispose(): void {
    this.#listeners.clear();
  }

  emit(event: MessagingEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

class MemoryMediaFiles implements MediaFileStore {
  readonly files = new Map<string, Uint8Array>();

  save(
    accountId: AccountId,
    attachmentId: AttachmentId,
    _fileName: string | undefined,
    bytes: Uint8Array,
  ): string {
    const path = `${accountId}/${attachmentId}`;
    this.files.set(path, bytes);
    return path;
  }

  read(localPath: string): Uint8Array {
    const bytes = this.files.get(localPath);
    if (!bytes) throw new Error('Missing media');
    return bytes;
  }

  removeAccount(accountId: AccountId): void {
    for (const path of this.files.keys()) {
      if (path.startsWith(`${accountId}/`)) this.files.delete(path);
    }
  }
}

class FakeMessagingProvider implements MessagingProvider {
  readonly sessions = new Map<AccountId, FakeMessagingSession>();

  createSession(accountId: AccountId): MessagingSession {
    const session = new FakeMessagingSession(accountId);
    this.sessions.set(accountId, session);
    return session;
  }

  sessionFor(accountId: AccountId): FakeMessagingSession {
    const session = this.sessions.get(accountId);
    if (!session) {
      throw new Error(`No fake session for ${accountId}`);
    }
    return session;
  }
}

function chatFixture(accountId: AccountId, overrides: Partial<ProviderChat> = {}): ProviderChat {
  return {
    accountId,
    remoteId: 'friend@remote',
    kind: 'direct',
    title: 'Friend',
    unreadCount: 0,
    ...overrides,
  };
}

function messageFixture(
  accountId: AccountId,
  overrides: Partial<ProviderMessage> = {},
): ProviderMessage {
  return {
    accountId,
    remoteId: 'msg-1',
    chatRemoteId: 'friend@remote',
    direction: 'incoming',
    sentAt: 200,
    content: { kind: 'text', text: 'Message' },
    ...overrides,
  };
}

describe('messaging projection semantics', () => {
  let directory: string;
  let database: SqliteDatabase;
  let repositories: RepositoryBundle;
  let provider: FakeMessagingProvider;
  let service: MessagingService;
  let mediaFiles: MemoryMediaFiles;
  let account: Account;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'multiomon-projection-'));
    database = SqliteDatabase.open(join(directory, 'multiomon.sqlite'));
    repositories = createRepositories(database);
    account = {
      id: createAccountId('projection-account'),
      displayName: 'Projection account',
      createdAt: 1,
    };
    repositories.accounts.save(account);
    provider = new FakeMessagingProvider();
    mediaFiles = new MemoryMediaFiles();
    service = new MessagingService(provider, database, repositories, mediaFiles);
    service.createAccountSession(account.id);
  });

  afterEach(() => {
    service.dispose();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('advances chat activity only when a message is newer than the stored activity', () => {
    const session = provider.sessionFor(account.id);
    session.emit({ type: 'chat.upserted', chat: chatFixture(account.id, { lastActivityAt: 300 }) });

    session.emit({
      type: 'message.upserted',
      message: messageFixture(account.id, { sentAt: 200 }),
    });
    expect(repositories.chats.getByRemoteId(account.id, 'friend@remote')).toMatchObject({
      lastActivityAt: 300,
    });

    session.emit({
      type: 'message.upserted',
      message: messageFixture(account.id, { remoteId: 'msg-2', sentAt: 400 }),
    });
    expect(repositories.chats.getByRemoteId(account.id, 'friend@remote')).toMatchObject({
      lastActivityAt: 400,
    });
  });

  it('defers to provider unread counts instead of counting messages', () => {
    const session = provider.sessionFor(account.id);
    session.emit({ type: 'chat.upserted', chat: chatFixture(account.id, { unreadCount: 2 }) });

    session.emit({ type: 'message.upserted', message: messageFixture(account.id) });
    expect(repositories.chats.getByRemoteId(account.id, 'friend@remote')).toMatchObject({
      unreadCount: 2,
    });

    session.emit({ type: 'chat.upserted', chat: chatFixture(account.id, { unreadCount: 3 }) });
    expect(repositories.chats.getByRemoteId(account.id, 'friend@remote')).toMatchObject({
      unreadCount: 3,
    });
  });

  it('creates chats from first messages with unread 1 for incoming and 0 for outgoing', () => {
    const session = provider.sessionFor(account.id);

    session.emit({
      type: 'message.upserted',
      message: messageFixture(account.id, { remoteId: 'new-1', chatRemoteId: 'stranger@remote' }),
    });
    expect(repositories.chats.getByRemoteId(account.id, 'stranger@remote')).toMatchObject({
      kind: 'direct',
      title: 'stranger@remote',
      unreadCount: 1,
      lastActivityAt: 200,
    });

    session.emit({
      type: 'message.upserted',
      message: messageFixture(account.id, {
        remoteId: 'new-2',
        chatRemoteId: 'self@remote',
        direction: 'outgoing',
      }),
    });
    expect(repositories.chats.getByRemoteId(account.id, 'self@remote')).toMatchObject({
      unreadCount: 0,
      lastActivityAt: 200,
    });
  });

  it('emits one projection change per distinct message and none for duplicates', () => {
    const session = provider.sessionFor(account.id);
    const changes = vi.fn();
    service.subscribe(changes);

    session.emit({ type: 'message.upserted', message: messageFixture(account.id) });
    session.emit({ type: 'message.upserted', message: messageFixture(account.id) });
    expect(changes).toHaveBeenCalledTimes(1);

    session.emit({ type: 'chat.upserted', chat: chatFixture(account.id) });
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('persists media metadata and caches provider downloads locally', async () => {
    const session = provider.sessionFor(account.id);
    session.emit({
      type: 'message.upserted',
      message: messageFixture(account.id, {
        content: {
          kind: 'media',
          attachmentKind: 'image',
          mediaType: 'image/jpeg',
          fileName: 'photo.jpg',
          sizeBytes: 12,
          caption: 'Photo',
          remoteReference: 'serialized-provider-message',
        },
      }),
    });

    const projected = repositories.messages.getByRemoteId(account.id, 'msg-1');
    if (!projected || projected.content.kind !== 'media') {
      throw new Error('Expected projected media message');
    }
    expect(
      repositories.attachments.getById(account.id, projected.content.attachmentId),
    ).toMatchObject({
      kind: 'image',
      mediaType: 'image/jpeg',
      fileName: 'photo.jpg',
      sizeBytes: 12,
      remoteReference: 'serialized-provider-message',
    });

    const first = await service.downloadAttachment(account.id, projected.content.attachmentId);
    const second = await service.downloadAttachment(account.id, projected.content.attachmentId);
    expect(new TextDecoder().decode(first.bytes)).toBe('serialized-provider-message');
    expect(second.bytes).toEqual(first.bytes);
    expect(session.mediaRequests).toEqual(['serialized-provider-message']);
    expect(mediaFiles.files.size).toBe(1);
  });

  it('requests older provider history from the oldest persisted message', async () => {
    const session = provider.sessionFor(account.id);
    session.emit({ type: 'chat.upserted', chat: chatFixture(account.id) });
    session.emit({ type: 'message.upserted', message: messageFixture(account.id) });

    const chat = repositories.chats.getByRemoteId(account.id, 'friend@remote');
    if (!chat) throw new Error('Expected projected chat');
    await service.requestHistory(account.id, chat.id);

    expect(session.historyRequests).toEqual([
      {
        chatRemoteId: 'friend@remote',
        oldestRemoteMessageId: 'msg-1',
        oldestDirection: 'incoming',
        oldestSentAt: 200,
        count: 50,
      },
    ]);
  });
});
