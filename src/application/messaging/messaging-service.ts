import type { ManagedAccountSession } from '../accounts/account-session';
import type { MediaFileStore } from '../ports/media-file-store';
import type {
  MessagingEvent,
  MessagingProvider,
  MessagingSession,
} from '../ports/messaging-provider';
import type { RepositoryBundle, TransactionRunner } from '../ports/repositories';
import {
  createChatId,
  createAttachmentId,
  createMessageId,
  createScopedRemoteKey,
  type AccountId,
  type AttachmentId,
  type ChatId,
} from '../../domain';
import { ProviderAccountSession } from './provider-account-session';

export interface MessagingProjectionChange {
  readonly accountId: AccountId;
  readonly chatId: ChatId;
}

export interface DownloadedAttachment {
  readonly attachmentId: AttachmentId;
  readonly mediaType: string;
  readonly kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  readonly bytes: Uint8Array;
  readonly fileName?: string;
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
  readonly code:
    | 'duplicate-session'
    | 'event-account-mismatch'
    | 'missing-session'
    | 'missing-chat'
    | 'missing-history-anchor'
    | 'missing-attachment'
    | 'media-unavailable';

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
  readonly #mediaFiles?: MediaFileStore;
  readonly #sessions = new Map<AccountId, SessionEntry>();
  readonly #listeners = new Set<MessagingProjectionListener>();
  readonly #pairingListeners = new Set<PairingEventListener>();

  constructor(
    provider: MessagingProvider,
    transactionRunner: TransactionRunner,
    repositories: RepositoryBundle,
    mediaFiles?: MediaFileStore,
  ) {
    this.#provider = provider;
    this.#transactionRunner = transactionRunner;
    this.#repositories = repositories;
    this.#mediaFiles = mediaFiles;
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

  async requestHistory(accountId: AccountId, chatId: ChatId, count = 50): Promise<void> {
    const chat = this.#repositories.chats.getById(accountId, chatId);
    if (!chat) {
      throw new MessagingApplicationError('missing-chat', `Chat ${chatId} does not exist`);
    }
    const oldest = this.#repositories.messages.getOldestByChat(accountId, chatId);
    if (!oldest) {
      throw new MessagingApplicationError(
        'missing-history-anchor',
        `Chat ${chatId} has no message to anchor history`,
      );
    }
    await this.getSession(accountId).requestHistory({
      chatRemoteId: chat.remoteId,
      oldestRemoteMessageId: oldest.remoteId,
      oldestDirection: oldest.direction,
      oldestSentAt: oldest.sentAt,
      count: Math.min(Math.max(Math.trunc(count), 1), 200),
    });
  }

  async downloadAttachment(
    accountId: AccountId,
    attachmentId: AttachmentId,
  ): Promise<DownloadedAttachment> {
    const attachment = this.#repositories.attachments.getById(accountId, attachmentId);
    if (!attachment) {
      throw new MessagingApplicationError(
        'missing-attachment',
        `Attachment ${attachmentId} does not exist`,
      );
    }
    const mediaFiles = this.#mediaFiles;
    if (!mediaFiles) {
      throw new MessagingApplicationError(
        'media-unavailable',
        'Local media storage is unavailable',
      );
    }

    let bytes: Uint8Array | undefined;
    if (attachment.localPath) {
      try {
        bytes = mediaFiles.read(attachment.localPath);
      } catch {
        // A missing cache file can be recovered from the provider reference below.
      }
    }
    if (!bytes) {
      if (!attachment.remoteReference) {
        throw new MessagingApplicationError(
          'media-unavailable',
          `Attachment ${attachmentId} has no downloadable provider reference`,
        );
      }
      bytes = await this.getSession(accountId).downloadMedia(attachment.remoteReference);
      const localPath = mediaFiles.save(accountId, attachment.id, attachment.fileName, bytes);
      this.#transactionRunner.runInTransaction(() => {
        this.#repositories.attachments.save({ ...attachment, localPath });
      });
    }

    return {
      attachmentId,
      kind: attachment.kind,
      mediaType: attachment.mediaType,
      bytes,
      ...(attachment.fileName === undefined ? {} : { fileName: attachment.fileName }),
    };
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
    this.#mediaFiles?.removeAccount(accountId);
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
    const messageId = createMessageId(createScopedRemoteKey(message.accountId, message.remoteId));
    const attachmentId =
      message.content.kind === 'media'
        ? createAttachmentId(createScopedRemoteKey(message.accountId, `${message.remoteId}:media`))
        : undefined;
    const content =
      message.content.kind === 'media'
        ? {
            kind: 'media' as const,
            attachmentId: attachmentId!,
            ...(message.content.caption === undefined ? {} : { caption: message.content.caption }),
          }
        : message.content;
    const inserted = this.#repositories.messages.insert({
      id: messageId,
      accountId: message.accountId,
      chatId,
      remoteId: message.remoteId,
      direction: message.direction,
      sentAt: message.sentAt,
      content,
      ...(message.senderRemoteId === undefined ? {} : { senderRemoteId: message.senderRemoteId }),
      ...(reply === null ? {} : { replyToMessageId: reply.id }),
    });
    if (inserted && message.content.kind === 'media' && attachmentId) {
      this.#repositories.attachments.save({
        id: attachmentId,
        accountId: message.accountId,
        messageId,
        kind: message.content.attachmentKind,
        mediaType: message.content.mediaType,
        remoteReference: message.content.remoteReference,
        ...(message.content.fileName === undefined ? {} : { fileName: message.content.fileName }),
        ...(message.content.sizeBytes === undefined
          ? {}
          : { sizeBytes: message.content.sizeBytes }),
      });
    }
    return inserted ? { accountId: message.accountId, chatId } : null;
  }
}
