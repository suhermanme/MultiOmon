import {
  ProviderError,
  type MessagingEvent,
  type MessagingEventListener,
  type MessagingSession,
  type ProviderChat,
  type ProviderConnectionState,
  type ProviderMessage,
  type SendTextRequest,
} from '../../../application/ports/messaging-provider';
import type { AccountId } from '../../../domain';
import type {
  AuthenticationState,
  Chat,
  WAVersion,
  WASocket,
  proto,
} from '@whiskeysockets/baileys';
import * as path from 'node:path';
import * as fs from 'node:fs';

function now(): number {
  return Date.now();
}

function extractPhoneFromJid(jid: string): string {
  return jid.split('@')[0] ?? jid;
}

function extractRemoteIdFromJid(jid: string): string {
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) {
    return jid;
  }
  return extractPhoneFromJid(jid);
}

function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

function normalizeBaileysChat(accountId: AccountId, jid: string, chat: Chat): ProviderChat {
  const remoteId = extractRemoteIdFromJid(jid);
  const isGroup = isGroupJid(jid);
  const title = chat.name ?? (isGroup ? `Group ${remoteId}` : extractPhoneFromJid(jid));
  const unreadCount = chat.unreadCount ?? 0;

  return {
    accountId,
    remoteId,
    kind: isGroup ? 'group' : 'direct',
    title,
    unreadCount,
  };
}

function normalizeBaileysMessage(
  accountId: AccountId,
  message: proto.IWebMessageInfo,
): ProviderMessage | null {
  const jid = message.key?.remoteJid;
  const messageId = message.key?.id;
  if (!jid || !messageId) return null;

  const chatRemoteId = extractRemoteIdFromJid(jid);
  const direction = message.key.fromMe ? 'outgoing' : 'incoming';
  const sentAt = message.messageTimestamp ? Number(message.messageTimestamp) * 1000 : now();

  let contentKind: 'text' | 'system';
  let text: string;

  if (message.message?.conversation) {
    contentKind = 'text';
    text = message.message.conversation;
  } else if (message.message?.extendedTextMessage?.text) {
    contentKind = 'text';
    text = message.message.extendedTextMessage.text;
  } else {
    contentKind = 'system';
    text = `[${message.message ? 'Unsupported message type' : 'Empty message'}]`;
  }

  return {
    accountId,
    remoteId: messageId,
    chatRemoteId,
    direction,
    ...(direction === 'incoming' ? { senderRemoteId: extractPhoneFromJid(jid) } : {}),
    sentAt,
    content: { kind: contentKind, text },
  };
}

export interface WhatsappSessionOptions {
  readonly phoneNumber?: string;
}

// Baileys types are imported statically (erased at compile time); the runtime transport is
// loaded lazily in #initializeSocket(). ADR-012 keeps both confined to this folder.

export class WhatsappMessagingSession implements MessagingSession {
  readonly accountId: AccountId;
  readonly #authDir: string;
  readonly #phoneNumber?: string;
  readonly #listeners: Set<MessagingEventListener> = new Set();
  #state: ProviderConnectionState;
  #socket: WASocket | null = null;
  #version: WAVersion | null = null;
  #authState: AuthenticationState | null = null;
  #saveCreds: (() => Promise<void>) | null = null;
  #attempt: number = 0;

  constructor(accountId: AccountId, authDir: string, options: WhatsappSessionOptions = {}) {
    this.accountId = accountId;
    this.#authDir = authDir;
    this.#phoneNumber = options.phoneNumber;
    this.#state = { kind: 'idle', changedAt: now() };
  }

  getConnectionState(): ProviderConnectionState {
    return this.#state;
  }

  async startPairing(): Promise<void> {
    if (this.#state.kind === 'connected' || this.#state.kind === 'connecting') {
      await this.disconnect('pairing-restarted');
    }
    if (this.#state.kind !== 'needsPairing') {
      this.#setState({ kind: 'needsPairing', changedAt: now() });
    }

    if (!this.#phoneNumber) {
      throw new ProviderError(
        this.accountId,
        'phone-number-required',
        'Phone number is required for pairing',
      );
    }

    await this.#initializeSocket();
    const pairingCode = await this.#socket!.requestPairingCode(this.#phoneNumber);

    this.#emit({
      type: 'pairing.code',
      accountId: this.accountId,
      code: pairingCode,
      expiresAt: now() + 5 * 60_000,
    });
  }

  async connect(): Promise<void> {
    if (this.#state.kind === 'connected') return;
    if (this.#state.kind === 'needsPairing') {
      throw new ProviderError(this.accountId, 'pairing-required', 'Account requires pairing');
    }

    this.#attempt += 1;
    this.#setState({ kind: 'connecting', changedAt: now(), attempt: this.#attempt });

    await this.#initializeSocket();
    this.#subscribeToEvents();
  }

  async disconnect(reason?: string): Promise<void> {
    if (this.#state.kind === 'disconnected') return;
    this.#setState({ kind: 'disconnected', changedAt: now(), reason });
    this.#cleanupSocket();
    await Promise.resolve();
  }

  async logout(): Promise<void> {
    if (this.#socket) {
      await this.#socket.logout();
    }
    this.#cleanupSocket();
    this.#removeAuthDirectory();
    if (this.#state.kind !== 'disconnected') {
      await this.disconnect('logged-out');
    }
    this.#setState({ kind: 'needsPairing', changedAt: now() });
  }

  async sendText(request: SendTextRequest): Promise<ProviderMessage> {
    if (this.#state.kind !== 'connected') {
      return Promise.reject(
        new ProviderError(this.accountId, 'not-connected', 'Cannot send while disconnected'),
      );
    }
    if (request.text.trim().length === 0) {
      return Promise.reject(
        new ProviderError(this.accountId, 'invalid-message', 'Message text cannot be empty'),
      );
    }
    if (!this.#socket) {
      return Promise.reject(
        new ProviderError(this.accountId, 'socket-not-available', 'Socket is not available'),
      );
    }

    const sentMessage = await this.#socket.sendMessage(
      request.chatRemoteId,
      { text: request.text },
      {
        ...(request.replyToRemoteMessageId !== undefined
          ? {
              // Baileys wants a full WAMessage here; the port only carries the quoted message id,
              // so the quoted participant and body stay unknown.
              quoted: {
                key: { id: request.replyToRemoteMessageId, remoteJid: request.chatRemoteId },
              },
            }
          : {}),
      },
    );

    if (!sentMessage) {
      throw new ProviderError(this.accountId, 'send-failed', 'Failed to send message');
    }

    const message: ProviderMessage = {
      accountId: this.accountId,
      remoteId: sentMessage.key?.id ?? `outgoing-${now()}`,
      chatRemoteId: extractRemoteIdFromJid(sentMessage.key?.remoteJid ?? request.chatRemoteId),
      direction: 'outgoing',
      sentAt: now(),
      content: { kind: 'text', text: request.text },
      ...(request.replyToRemoteMessageId !== undefined
        ? { replyToRemoteMessageId: request.replyToRemoteMessageId }
        : {}),
    };

    this.#emit({ type: 'message.upserted', message });
    return message;
  }

  subscribe(listener: MessagingEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#cleanupSocket();
  }

  #setState(state: ProviderConnectionState): void {
    this.#state = state;
    this.#emit({ type: 'connection.changed', state });
  }

  #emit(event: MessagingEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors should not break event emission
      }
    }
  }

  async #initializeSocket(): Promise<void> {
    if (this.#socket) {
      return;
    }

    // ADR-012: static import cannot work here — the transport is selected at runtime
    // (WHATSAPP_PROVIDER in src/main/index.ts), so mock mode and unit tests of this class
    // must not load the ESM-only Baileys protocol stack.
    const baileys = await import('@whiskeysockets/baileys');

    if (!this.#authState || !this.#saveCreds) {
      const sessionDir = path.join(this.#authDir, this.accountId);
      fs.mkdirSync(sessionDir, { recursive: true });
      const authResult = await baileys.useMultiFileAuthState(sessionDir);
      this.#authState = authResult.state;
      this.#saveCreds = authResult.saveCreds;
    }

    if (!this.#version) {
      this.#version = (await baileys.fetchLatestBaileysVersion()).version;
    }

    const authState = this.#authState;
    const saveCreds = this.#saveCreds;
    if (!authState || !saveCreds) {
      throw new ProviderError(
        this.accountId,
        'auth-unavailable',
        'Authentication state is unavailable',
      );
    }

    const version = this.#version;
    this.#socket = baileys.makeWASocket({ version, auth: authState });

    // Persist credentials whenever they update
    this.#socket.ev.on('creds.update', () => {
      void saveCreds();
    });
  }

  #subscribeToEvents(): void {
    const socket = this.#socket;
    if (!socket) return;

    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        this.#setState({ kind: 'connected', changedAt: now(), connectedAt: now() });
      } else if (connection === 'close') {
        const disconnectError = lastDisconnect?.error;
        const statusCode =
          disconnectError && 'output' in disconnectError
            ? disconnectError.output.statusCode
            : undefined;
        const isAuthError =
          statusCode === 401 || (disconnectError?.message?.includes('401') ?? false);

        if (isAuthError) {
          // Logged out — do not auto-reconnect
          this.#setState({
            kind: 'failed',
            changedAt: now(),
            errorCode: 'auth-failure',
            message: disconnectError?.message ?? 'Authentication failed. Please re-pair.',
          });
        } else {
          // Transient disconnect — reconnect
          this.#setState({
            kind: 'disconnected',
            changedAt: now(),
            reason: 'connection-lost',
          });
          this.#cleanupSocket();
          setTimeout(() => {
            void this.connect();
          }, 5000);
        }
      }
    });

    socket.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        this.#emit({
          type: 'chat.upserted',
          chat: normalizeBaileysChat(this.accountId, chat.id, chat),
        });
      }
    });

    socket.ev.on('messages.upsert', ({ messages }) => {
      for (const message of messages) {
        const normalized = normalizeBaileysMessage(this.accountId, message);
        if (normalized) {
          this.#emit({ type: 'message.upserted', message: normalized });
        }
      }
    });
  }

  #cleanupSocket(): void {
    const socket = this.#socket;
    if (!socket) return;

    socket.ev.removeAllListeners('connection.update');
    socket.ev.removeAllListeners('chats.upsert');
    socket.ev.removeAllListeners('messages.upsert');
    socket.ev.removeAllListeners('creds.update');
    socket.end(undefined);
    this.#socket = null;
  }

  #removeAuthDirectory(): void {
    const sessionDir = path.join(this.#authDir, this.accountId);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
  }
}
