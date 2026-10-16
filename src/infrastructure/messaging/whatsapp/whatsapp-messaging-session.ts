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
  ChatUpdate,
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
  const activitySeconds = chat.conversationTimestamp ?? chat.lastMessageRecvTimestamp;

  return {
    accountId,
    remoteId,
    kind: isGroup ? 'group' : 'direct',
    title,
    unreadCount,
    ...(activitySeconds === undefined || activitySeconds === null
      ? {}
      : { lastActivityAt: Number(activitySeconds) * 1000 }),
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

export interface WhatsappReconnectOptions {
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly factor?: number;
}

export interface WhatsappSessionOptions {
  readonly phoneNumber?: string;
  readonly reconnect?: WhatsappReconnectOptions;
}

const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_FACTOR = 2;

// Baileys types are imported statically (erased at compile time); the runtime transport is
// loaded lazily in #initializeSocket(). ADR-012 keeps both confined to this folder.

export class WhatsappMessagingSession implements MessagingSession {
  readonly accountId: AccountId;
  readonly #authDir: string;
  readonly #phoneNumber?: string;
  readonly #reconnectBaseDelayMs: number;
  readonly #reconnectMaxDelayMs: number;
  readonly #reconnectFactor: number;
  readonly #listeners: Set<MessagingEventListener> = new Set();
  #state: ProviderConnectionState;
  #socket: WASocket | null = null;
  #version: WAVersion | null = null;
  #authState: AuthenticationState | null = null;
  #saveCreds: (() => Promise<void>) | null = null;
  readonly #knownChats = new Map<string, ProviderChat>();
  #eventsSubscribed = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempt = 0;
  #attempt: number = 0;
  #disposed = false;

  constructor(accountId: AccountId, authDir: string, options: WhatsappSessionOptions = {}) {
    this.accountId = accountId;
    this.#authDir = authDir;
    this.#phoneNumber = options.phoneNumber;
    this.#reconnectBaseDelayMs = options.reconnect?.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    this.#reconnectMaxDelayMs = options.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    this.#reconnectFactor = options.reconnect?.factor ?? DEFAULT_RECONNECT_FACTOR;
    this.#state = { kind: 'idle', changedAt: now() };
  }

  getConnectionState(): ProviderConnectionState {
    return this.#state;
  }

  async startPairing(): Promise<void> {
    this.#assertNotDisposed();
    this.#cancelReconnect();

    if (this.#state.kind === 'connected' || this.#state.kind === 'connecting') {
      await this.disconnect('pairing-restarted');
    }
    if (this.#state.kind !== 'needsPairing') {
      this.#setState({ kind: 'needsPairing', changedAt: now() });
    }

    // Pairing is driven by socket events: subscribe before anything is requested so the
    // `qr` stream is delivered to subscribers.
    await this.#initializeSocket();
    this.#subscribeToEvents();

    const phoneNumber = this.#phoneNumber;
    if (!phoneNumber) {
      // No phone number on record: pairing continues through `pairing.qr` only.
      return;
    }

    const socket = this.#socket;
    if (!socket) {
      throw new ProviderError(this.accountId, 'socket-not-available', 'Socket is not available');
    }

    const pairingCode = await socket.requestPairingCode(phoneNumber);
    this.#emit({
      type: 'pairing.code',
      accountId: this.accountId,
      code: pairingCode,
      expiresAt: now() + 5 * 60_000,
    });
  }

  async connect(): Promise<void> {
    this.#assertNotDisposed();
    if (this.#state.kind === 'connected') return;
    if (this.#state.kind === 'needsPairing') {
      throw new ProviderError(this.accountId, 'pairing-required', 'Account requires pairing');
    }

    this.#cancelReconnect();
    this.#attempt += 1;
    this.#setState({ kind: 'connecting', changedAt: now(), attempt: this.#attempt });

    await this.#initializeSocket();
    this.#subscribeToEvents();
  }

  async disconnect(reason?: string): Promise<void> {
    if (this.#disposed) return;
    this.#cancelReconnect();
    if (this.#state.kind === 'disconnected') return;
    this.#setState({ kind: 'disconnected', changedAt: now(), reason });
    this.#cleanupSocket();
    await Promise.resolve();
  }

  async logout(): Promise<void> {
    if (this.#disposed) return;
    this.#cancelReconnect();
    if (this.#socket) {
      await this.#socket.logout();
    }
    this.#cleanupSocket();
    this.#removeAuthDirectory();
    // Credentials are gone from disk; #cleanupSocket already dropped the in-memory state,
    // so no later connect() can reuse or re-save them.
    this.#attempt = 0;
    this.#reconnectAttempt = 0;
    if (this.#state.kind !== 'disconnected') {
      await this.disconnect('logged-out');
    }
    this.#setState({ kind: 'needsPairing', changedAt: now() });
  }

  async sendText(request: SendTextRequest): Promise<ProviderMessage> {
    this.#assertNotDisposed();
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
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelReconnect();
    this.#cleanupSocket();
    this.#listeners.clear();
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new ProviderError(this.accountId, 'session-disposed', 'Session has been disposed');
    }
  }

  #cancelReconnect(): void {
    if (!this.#reconnectTimer) return;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }

  #scheduleReconnect(): void {
    if (this.#disposed) return;
    this.#cancelReconnect();
    const delayMs = Math.min(
      this.#reconnectBaseDelayMs * this.#reconnectFactor ** this.#reconnectAttempt,
      this.#reconnectMaxDelayMs,
    );
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.connect().catch(() => {
        // A failed reconnect is another disconnect: back off and try again.
        if (this.#disposed || this.#state.kind === 'needsPairing') return;
        this.#setState({ kind: 'disconnected', changedAt: now(), reason: 'reconnect-failed' });
        this.#scheduleReconnect();
      });
    }, delayMs);
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
    if (!socket || this.#eventsSubscribed) return;
    this.#eventsSubscribed = true;

    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      // Baileys 6.7.x carries the pairing QR on connection.update (State.d.ts: `qr?: string`),
      // re-emitting every ~20s until login; `{ qr: undefined }` clears it.
      if (typeof update.qr === 'string') {
        this.#emit({ type: 'pairing.qr', accountId: this.accountId, payload: update.qr });
      }
      if (connection === 'open') {
        this.#cancelReconnect();
        this.#reconnectAttempt = 0;
        if (this.#state.kind !== 'connected' && this.#state.kind !== 'connecting') {
          // A socket opened by startPairing() must announce the attempt before it can be
          // reported as connected; the domain transitions are strict.
          this.#attempt += 1;
          this.#setState({ kind: 'connecting', changedAt: now(), attempt: this.#attempt });
        }
        this.#attempt = 0;
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
          // Transient disconnect — reconnect with exponential backoff
          this.#setState({
            kind: 'disconnected',
            changedAt: now(),
            reason: 'connection-lost',
          });
          this.#cleanupSocket();
          this.#scheduleReconnect();
        }
      }
    });

    socket.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        const normalized = normalizeBaileysChat(this.accountId, chat.id, chat);
        this.#knownChats.set(normalized.remoteId, normalized);
        this.#emit({ type: 'chat.upserted', chat: normalized });
      }
    });

    // History sync (M06): Baileys delivers the conversation list and recent messages
    // reverse-chronologically on connect; map them onto the normalized events the
    // projection already understands.
    socket.ev.on('messaging-history.set', ({ chats, messages }) => {
      for (const chat of chats) {
        const normalized = normalizeBaileysChat(this.accountId, chat.id, chat);
        this.#knownChats.set(normalized.remoteId, normalized);
        this.#emit({ type: 'chat.upserted', chat: normalized });
      }
      for (const message of messages) {
        const normalized = normalizeBaileysMessage(this.accountId, message);
        if (normalized) {
          this.#emit({ type: 'message.upserted', message: normalized });
        }
      }
    });

    socket.ev.on('chats.update', (updates) => {
      for (const update of updates) {
        this.#mergeChatUpdate(update);
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
    socket.ev.removeAllListeners('chats.update');
    socket.ev.removeAllListeners('messaging-history.set');
    socket.ev.removeAllListeners('messages.upsert');
    socket.ev.removeAllListeners('creds.update');
    socket.end(undefined);
    this.#socket = null;
    this.#eventsSubscribed = false;
    // Disk is the source of truth for multi-file auth: each new socket re-reads it so a
    // reconnect can never run on stale in-memory credentials.
    this.#authState = null;
    this.#saveCreds = null;
    // #knownChats survives reconnects: history.set re-anchors absolute values, and
    // chats.update deltas need the last known base to merge correctly.
  }

  // Baileys `chats.update` carries unreadCount as a DELTA: process-message.js builds a
  // fresh patch `unreadCount: (chat.unreadCount || 0) + 1` per incoming message and
  // event-buffer.js merges patches additively. `null`/`0` are absolute marks-read;
  // protobuf Longs arrive only from absolute server payloads (history/upsert), so they
  // are treated as absolute here.
  #mergeChatUpdate(update: ChatUpdate): void {
    if (typeof update.id !== 'string') {
      return;
    }
    const remoteId = extractRemoteIdFromJid(update.id);
    const isGroup = isGroupJid(update.id);
    const base = this.#knownChats.get(remoteId) ?? {
      accountId: this.accountId,
      remoteId,
      kind: isGroup ? 'group' : 'direct',
      title: update.name ?? (isGroup ? `Group ${remoteId}` : extractPhoneFromJid(update.id)),
      unreadCount: 0,
    };

    const unread = update.unreadCount;
    const unreadCount =
      unread === null || unread === 0
        ? 0
        : typeof unread === 'number'
          ? Math.max(base.unreadCount + unread, 0)
          : unread === undefined
            ? base.unreadCount
            : Number(unread);

    const activitySeconds = update.conversationTimestamp ?? update.lastMsgTimestamp;
    const merged: ProviderChat = {
      ...base,
      ...(typeof update.name === 'string' ? { title: update.name } : {}),
      ...(activitySeconds === undefined || activitySeconds === null
        ? {}
        : { lastActivityAt: Number(activitySeconds) * 1000 }),
      unreadCount,
    };

    this.#knownChats.set(remoteId, merged);
    this.#emit({ type: 'chat.upserted', chat: merged });
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
