import type { ManagedAccountSession } from '../accounts/account-session';
import type {
  MessagingEvent,
  MessagingProvider,
  MessagingSession,
} from '../ports/messaging-provider';
import type { RepositoryBundle, TransactionRunner } from '../ports/repositories';
import {
  createChatId,
  createMessageId,
  createScopedRemoteKey,
  type AccountId,
  type ChatId,
} from '../../domain';
import { ProviderAccountSession } from './provider-account-session';

export interface MessagingProjectionChange {
  readonly accountId: AccountId;
  readonly chatId: ChatId;
}

export type MessagingProjectionListener = (change: MessagingProjectionChange) => void;

export type PairingEvent = Extract<MessagingEvent, { type: 'pairing.code' | 'pairing.qr' }>;
export type PairingEventListener = (event: PairingEvent) => void;

interface SessionEntry {
  readonly session: MessagingSession;
  readonly managedSession: ProviderAccountSession;
  readonly unsubscribeProjection: () => void;
}

export class MessagingApplicationError extends Error {
  readonly code: 'duplicate-session' | 'event-account-mismatch' | 'missing-session';

  constructor(code: MessagingApplicationError['code'], message: string) {
    super(message);
    this.name = 'MessagingApplicationError';
    this.code = code;
  }
}

export class MessagingService {
  readonly #provider: MessagingProvider;
  readonly #transactionRunner: TransactionRunner;
  readonly #repositories: RepositoryBundle;
  readonly #sessions = new Map<AccountId, SessionEntry>();
  readonly #listeners = new Set<MessagingProjectionListener>();
  readonly #pairingListeners = new Set<PairingEventListener>();

  constructor(
    provider: MessagingProvider,
    transactionRunner: TransactionRunner,
    repositories: RepositoryBundle,
  ) {
    this.#provider = provider;
    this.#transactionRunner = transactionRunner;
    this.#repositories = repositories;
  }

  createAccountSession(accountId: AccountId): ManagedAccountSession {
    if (this.#sessions.has(accountId)) {
      throw new MessagingApplicationError(
        'duplicate-session',
        `Messaging session for ${accountId} already exists`,
      );
    }

    const session = this.#provider.createSession(accountId);
    if (session.accountId !== accountId) {
      throw new MessagingApplicationError(
        'event-account-mismatch',
        `Provider created a session for ${session.accountId} instead of ${accountId}`,
      );
    }
    const managedSession = new ProviderAccountSession(session);
    const unsubscribeProjection = session.subscribe((event) => this.#handleEvent(accountId, event));
    this.#sessions.set(accountId, { session, managedSession, unsubscribeProjection });
    return managedSession;
  }

  getSession(accountId: AccountId): MessagingSession {
    const entry = this.#sessions.get(accountId);
    if (!entry) {
      throw new MessagingApplicationError(
        'missing-session',
        `Messaging session for ${accountId} does not exist`,
      );
    }
    return entry.session;
  }

  subscribe(listener: MessagingProjectionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribePairing(listener: PairingEventListener): () => void {
    this.#pairingListeners.add(listener);
    return () => this.#pairingListeners.delete(listener);
  }

  hasAccountSession(accountId: AccountId): boolean {
    return this.#sessions.has(accountId);
  }

  removeAccountSession(accountId: AccountId): void {
    const entry = this.#sessions.get(accountId);
    if (!entry) {
      throw new MessagingApplicationError(
        'missing-session',
        `Messaging session for ${accountId} does not exist`,
      );
    }
    entry.unsubscribeProjection();
    entry.managedSession.dispose();
    entry.session.dispose();
    this.#sessions.delete(accountId);
  }

  dispose(): void {
    for (const entry of this.#sessions.values()) {
      entry.unsubscribeProjection();
      entry.managedSession.dispose();
      entry.session.dispose();
    }
    this.#sessions.clear();
    this.#listeners.clear();
    this.#pairingListeners.clear();
  }

  #handleEvent(expectedAccountId: AccountId, event: MessagingEvent): void {
    if (event.type === 'connection.changed') return;

    if (event.type === 'pairing.code' || event.type === 'pairing.qr') {
      if (event.accountId !== expectedAccountId) {
        throw new MessagingApplicationError(
          'event-account-mismatch',
          `Provider pairing event for ${event.accountId} arrived on session ${expectedAccountId}`,
        );
      }
      for (const listener of this.#pairingListeners) listener(event);
      return;
    }
    const eventAccountId =
      event.type === 'chat.upserted' ? event.chat.accountId : event.message.accountId;
    if (eventAccountId !== expectedAccountId) {
      throw new MessagingApplicationError(
        'event-account-mismatch',
        `Provider event for ${eventAccountId} arrived on session ${expectedAccountId}`,
      );
    }

    const change = this.#transactionRunner.runInTransaction(() =>
      event.type === 'chat.upserted'
        ? this.#projectChat(event.chat)
        : this.#projectMessage(event.message),
    );
    if (!change) return;
    for (const listener of this.#listeners) listener(change);
  }

  #projectChat(
    chat: Extract<MessagingEvent, { type: 'chat.upserted' }>['chat'],
  ): MessagingProjectionChange {
    const existing = this.#repositories.chats.getByRemoteId(chat.accountId, chat.remoteId);
    const chatId =
      existing?.id ?? createChatId(createScopedRemoteKey(chat.accountId, chat.remoteId));
    this.#repositories.chats.save({
      id: chatId,
      accountId: chat.accountId,
      remoteId: chat.remoteId,
      kind: chat.kind,
      title: chat.title,
      unreadCount: chat.unreadCount,
      ...(chat.lastActivityAt === undefined ? {} : { lastActivityAt: chat.lastActivityAt }),
    });
    return { accountId: chat.accountId, chatId };
  }

  #projectMessage(
    message: Extract<MessagingEvent, { type: 'message.upserted' }>['message'],
  ): MessagingProjectionChange | null {
    const existingChat = this.#repositories.chats.getByRemoteId(
      message.accountId,
      message.chatRemoteId,
    );
    const chatId =
      existingChat?.id ??
      createChatId(createScopedRemoteKey(message.accountId, message.chatRemoteId));
    if (existingChat) {
      const currentActivity = existingChat.lastActivityAt ?? 0;
      if (message.sentAt > currentActivity) {
        this.#repositories.chats.save({
          ...existingChat,
          lastActivityAt: message.sentAt,
        });
      }
    } else {
      this.#repositories.chats.save({
        id: chatId,
        accountId: message.accountId,
        remoteId: message.chatRemoteId,
        kind: 'direct',
        title: message.chatRemoteId,
        unreadCount: message.direction === 'incoming' ? 1 : 0,
        lastActivityAt: message.sentAt,
      });
    }

    const reply = message.replyToRemoteMessageId
      ? this.#repositories.messages.getByRemoteId(message.accountId, message.replyToRemoteMessageId)
      : null;
    const inserted = this.#repositories.messages.insert({
      id: createMessageId(createScopedRemoteKey(message.accountId, message.remoteId)),
      accountId: message.accountId,
      chatId,
      remoteId: message.remoteId,
      direction: message.direction,
      sentAt: message.sentAt,
      content: message.content,
      ...(message.senderRemoteId === undefined ? {} : { senderRemoteId: message.senderRemoteId }),
      ...(reply === null ? {} : { replyToMessageId: reply.id }),
    });
    return inserted ? { accountId: message.accountId, chatId } : null;
  }
}
