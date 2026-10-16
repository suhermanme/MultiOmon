import {
  ProviderError,
  type HistoryRequest,
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
  Contact,
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

function canonicalizeJid(jid: string): string {
  const separator = jid.indexOf('@');
  if (separator < 0) return jid;
  const user = jid.slice(0, separator).split(':')[0] ?? jid.slice(0, separator);
  return `${user}@${jid.slice(separator + 1)}`;
}

function isLidJid(jid: string): boolean {
  return canonicalizeJid(jid).endsWith('@lid');
}

function extractRemoteIdFromJid(jid: string): string {
  const canonicalJid = canonicalizeJid(jid);
  return canonicalJid.endsWith('@s.whatsapp.net')
    ? extractPhoneFromJid(canonicalJid)
    : canonicalJid;
}

function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

function toWhatsappJid(remoteId: string): string {
  return remoteId.includes('@') ? remoteId : `${remoteId}@s.whatsapp.net`;
}

function unwrapMessageContent(
  content: proto.IMessage | null | undefined,
): proto.IMessage | undefined {
  if (!content) return undefined;
  return (
    content.ephemeralMessage?.message ??
    content.viewOnceMessage?.message ??
    content.viewOnceMessageV2?.message ??
    content.viewOnceMessageV2Extension?.message ??
    content
  );
}

interface MediaDescriptor {
  readonly attachmentKind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  readonly mediaType: string;
  readonly remoteValue: { readonly fileLength?: unknown };
  readonly fileName?: string;
  readonly caption?: string;
}

function normalizeBaileysChat(
  accountId: AccountId,
  jid: string,
  chat: Chat,
  identity?: { readonly displayName?: string; readonly phoneJid?: string },
): ProviderChat {
  const remoteId = extractRemoteIdFromJid(jid);
  const isGroup = isGroupJid(jid);
  const title =
    chat.name ??
    identity?.displayName ??
    (isGroup
      ? `Group ${remoteId}`
      : identity?.phoneJid
        ? extractPhoneFromJid(identity.phoneJid)
        : isLidJid(jid)
          ? 'WhatsApp contact'
          : extractPhoneFromJid(jid));
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
  serializeMessage: (message: proto.IWebMessageInfo) => string,
  resolveJid: (jid: string) => string = (jid) => jid,
): ProviderMessage | null {
  const jid = message.key?.remoteJid;
  const messageId = message.key?.id;
  if (!jid || !messageId) return null;

  const chatRemoteId = extractRemoteIdFromJid(jid);
  const direction = message.key.fromMe ? 'outgoing' : 'incoming';
  const sentAt = message.messageTimestamp ? Number(message.messageTimestamp) * 1000 : now();

  const content = unwrapMessageContent(message.message);
  // History synchronization and encryption housekeeping are transport-control packets, not chat
  // messages. Persisting them produced a wall of false "Unsupported message type" bubbles.
  if (!content || content.protocolMessage || content.senderKeyDistributionMessage) return null;
  const media: MediaDescriptor | undefined = content?.imageMessage
    ? {
        attachmentKind: 'image',
        mediaType: content.imageMessage.mimetype ?? 'image/jpeg',
        remoteValue: content.imageMessage,
        ...(content.imageMessage.caption ? { caption: content.imageMessage.caption } : {}),
      }
    : content?.videoMessage
      ? {
          attachmentKind: 'video',
          mediaType: content.videoMessage.mimetype ?? 'video/mp4',
          remoteValue: content.videoMessage,
          ...(content.videoMessage.caption ? { caption: content.videoMessage.caption } : {}),
        }
      : content?.audioMessage
        ? {
            attachmentKind: 'audio',
            mediaType: content.audioMessage.mimetype ?? 'audio/ogg',
            remoteValue: content.audioMessage,
          }
        : content?.documentMessage
          ? {
              attachmentKind: 'document',
              mediaType: content.documentMessage.mimetype ?? 'application/octet-stream',
              remoteValue: content.documentMessage,
              ...(content.documentMessage.fileName
                ? { fileName: content.documentMessage.fileName }
                : {}),
              ...(content.documentMessage.caption
                ? { caption: content.documentMessage.caption }
                : {}),
            }
          : content?.stickerMessage
            ? {
                attachmentKind: 'sticker',
                mediaType: content.stickerMessage.mimetype ?? 'image/webp',
                remoteValue: content.stickerMessage,
              }
            : undefined;

  const normalizedContent: ProviderMessage['content'] = content?.conversation
    ? { kind: 'text', text: content.conversation }
    : content?.extendedTextMessage?.text
      ? { kind: 'text', text: content.extendedTextMessage.text }
      : media
        ? {
            kind: 'media',
            attachmentKind: media.attachmentKind,
            mediaType: media.mediaType,
            remoteReference: serializeMessage(message),
            ...(media.fileName ? { fileName: media.fileName } : {}),
            ...(media.remoteValue.fileLength === undefined || media.remoteValue.fileLength === null
              ? {}
              : { sizeBytes: Number(media.remoteValue.fileLength) }),
            ...(media.caption ? { caption: media.caption } : {}),
          }
        : { kind: 'system', text: '[Unsupported message type]' };

  return {
    accountId,
    remoteId: messageId,
    chatRemoteId,
    direction,
    ...(direction === 'incoming'
      ? { senderRemoteId: extractPhoneFromJid(resolveJid(message.key?.participant ?? jid)) }
      : {}),
    sentAt,
    content: normalizedContent,
  };
}

export interface WhatsappReconnectOptions {
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly factor?: number;
}

export interface WhatsappSessionOptions {
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
  readonly #reconnectBaseDelayMs: number;
  readonly #reconnectMaxDelayMs: number;
  readonly #reconnectFactor: number;
  readonly #listeners: Set<MessagingEventListener> = new Set();
  #state: ProviderConnectionState;
  #socket: WASocket | null = null;
  #version: WAVersion | null = null;
  #authState: AuthenticationState | null = null;
  #saveCreds: (() => Promise<void>) | null = null;
  #serializeMessage: ((message: proto.IWebMessageInfo) => string) | null = null;
  #downloadMessage: ((remoteReference: string) => Promise<Uint8Array>) | null = null;
  readonly #knownChats = new Map<string, ProviderChat>();
  readonly #lidToPhoneJid = new Map<string, string>();
  readonly #contactNames = new Map<string, string>();
  #eventsSubscribed = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempt = 0;
  #attempt: number = 0;
  #disposed = false;

  constructor(accountId: AccountId, authDir: string, options: WhatsappSessionOptions = {}) {
    this.accountId = accountId;
    this.#authDir = authDir;
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
    await this.#initializeSocket(true);
    this.#subscribeToEvents();

    // Pair always uses WhatsApp's QR flow. A phone number stored on the account is metadata, not
    // an implicit request for Baileys' separate pairing-code protocol. The QR arrives through the
    // subscribed `connection.update` stream once the socket handshake completes.
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

    const remoteJid = toWhatsappJid(request.chatRemoteId);
    const sentMessage = await this.#socket.sendMessage(
      remoteJid,
      { text: request.text },
      {
        ...(request.replyToRemoteMessageId !== undefined
          ? {
              // Baileys wants a full WAMessage here; the port only carries the quoted message id,
              // so the quoted participant and body stay unknown.
              quoted: {
                key: { id: request.replyToRemoteMessageId, remoteJid },
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

  async requestHistory(request: HistoryRequest): Promise<void> {
    this.#assertNotDisposed();
    if (this.#state.kind !== 'connected' || !this.#socket) {
      throw new ProviderError(
        this.accountId,
        'not-connected',
        'Cannot sync history while disconnected',
      );
    }
    await this.#socket.fetchMessageHistory(
      request.count,
      {
        remoteJid: toWhatsappJid(request.chatRemoteId),
        id: request.oldestRemoteMessageId,
        fromMe: request.oldestDirection === 'outgoing',
      },
      request.oldestSentAt,
    );
  }

  async downloadMedia(remoteReference: string): Promise<Uint8Array> {
    this.#assertNotDisposed();
    if (this.#state.kind !== 'connected' || !this.#downloadMessage) {
      throw new ProviderError(
        this.accountId,
        'not-connected',
        'Cannot download media while disconnected',
      );
    }
    return this.#downloadMessage(remoteReference);
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

  async #initializeSocket(resetIncompletePairing = false): Promise<void> {
    if (this.#socket) {
      return;
    }

    // ADR-012: static import cannot work here — the transport is selected at runtime
    // (WHATSAPP_PROVIDER in src/main/index.ts), so mock mode and unit tests of this class
    // must not load the ESM-only Baileys protocol stack.
    const baileys = await import('@whiskeysockets/baileys');

    this.#serializeMessage ??= (message) =>
      Buffer.from(baileys.proto.WebMessageInfo.encode(message).finish()).toString('base64');
    this.#downloadMessage ??= async (remoteReference) => {
      const message = baileys.proto.WebMessageInfo.decode(Buffer.from(remoteReference, 'base64'));
      const bytes = await baileys.downloadMediaMessage(message, 'buffer', {});
      return new Uint8Array(bytes);
    };

    if (!this.#authState || !this.#saveCreds) {
      const sessionDir = path.join(this.#authDir, this.accountId);
      fs.mkdirSync(sessionDir, { recursive: true });
      let authResult = await baileys.useMultiFileAuthState(sessionDir);
      // Baileys' pairing-code protocol can persist `creds.me` before its registration stanza
      // succeeds. Older app versions used that protocol whenever an account had a phone number.
      // An explicit Pair action may reset only this unregistered partial state so the QR flow can
      // start cleanly; fully registered credentials are never removed here.
      if (
        resetIncompletePairing &&
        !authResult.state.creds.registered &&
        authResult.state.creds.me
      ) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        fs.mkdirSync(sessionDir, { recursive: true });
        authResult = await baileys.useMultiFileAuthState(sessionDir);
      }
      this.#authState = authResult.state;
      this.#saveCreds = authResult.saveCreds;
      const ownIdentity = authResult.state.creds.me;
      if (ownIdentity?.lid && ownIdentity.id) {
        this.#rememberLidMapping(ownIdentity.lid, ownIdentity.id);
      }
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
    // WhatsApp sends the conversation/message snapshot only when history sync is enabled. Baileys
    // defaults this off, which can leave a successfully linked account with an empty local view.
    this.#socket = baileys.makeWASocket({
      version,
      auth: authState,
      browser: ['Ubuntu', 'Desktop', '22.04.4'],
      syncFullHistory: true,
    });

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
        const normalized = this.#normalizeChat(chat.id, chat);
        this.#knownChats.set(normalized.remoteId, normalized);
        this.#emit({ type: 'chat.upserted', chat: normalized });
      }
    });

    // History sync (M06): Baileys delivers the conversation list and recent messages
    // reverse-chronologically on connect; map them onto the normalized events the
    // projection already understands.
    socket.ev.on('messaging-history.set', ({ chats, contacts = [], messages }) => {
      for (const contact of contacts) this.#rememberContact(contact);
      for (const chat of chats) {
        const normalized = this.#normalizeChat(chat.id, chat);
        this.#knownChats.set(normalized.remoteId, normalized);
        this.#emit({ type: 'chat.upserted', chat: normalized });
      }
      for (const message of messages) {
        const normalized = normalizeBaileysMessage(
          this.accountId,
          message,
          this.#requireSerializer(),
          (jid) => this.#resolveJid(jid),
        );
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

    socket.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) this.#rememberContact(contact);
    });

    socket.ev.on('contacts.update', (contacts) => {
      for (const contact of contacts) this.#rememberContact(contact);
    });

    socket.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      this.#rememberLidMapping(lid, jid);
    });

    socket.ev.on('messages.upsert', ({ messages }) => {
      for (const message of messages) {
        const normalized = normalizeBaileysMessage(
          this.accountId,
          message,
          this.#requireSerializer(),
          (jid) => this.#resolveJid(jid),
        );
        if (normalized) {
          this.#emit({ type: 'message.upserted', message: normalized });
        }
      }
    });
  }

  #requireSerializer(): (message: proto.IWebMessageInfo) => string {
    const serializeMessage = this.#serializeMessage;
    if (!serializeMessage) {
      throw new ProviderError(
        this.accountId,
        'media-unavailable',
        'Media serializer is unavailable',
      );
    }
    return serializeMessage;
  }

  #normalizeChat(jid: string, chat: Chat): ProviderChat {
    const canonicalJid = canonicalizeJid(jid);
    const resolvedJid = this.#resolveJid(canonicalJid);
    return normalizeBaileysChat(this.accountId, canonicalJid, chat, {
      ...((this.#contactNames.get(canonicalJid) ?? this.#contactNames.get(resolvedJid))
        ? {
            displayName:
              this.#contactNames.get(canonicalJid) ?? this.#contactNames.get(resolvedJid),
          }
        : {}),
      ...(resolvedJid === canonicalJid ? {} : { phoneJid: resolvedJid }),
    });
  }

  #resolveJid(jid: string): string {
    const canonicalJid = canonicalizeJid(jid);
    return this.#lidToPhoneJid.get(canonicalJid) ?? canonicalJid;
  }

  #rememberContact(contact: Partial<Contact>): void {
    const id = typeof contact.id === 'string' ? canonicalizeJid(contact.id) : undefined;
    const lid = typeof contact.lid === 'string' ? canonicalizeJid(contact.lid) : undefined;
    const jid = typeof contact.jid === 'string' ? canonicalizeJid(contact.jid) : undefined;
    const displayName = contact.name ?? contact.notify ?? contact.verifiedName;

    if (lid && jid) this.#rememberLidMapping(lid, jid);
    if (displayName) {
      for (const key of [id, lid, jid]) {
        if (key) this.#contactNames.set(key, displayName);
      }
    }
  }

  #rememberLidMapping(lid: string, jid: string): void {
    const canonicalLid = canonicalizeJid(lid);
    const canonicalPhoneJid = canonicalizeJid(jid);
    this.#lidToPhoneJid.set(canonicalLid, canonicalPhoneJid);

    const remoteId = extractRemoteIdFromJid(canonicalLid);
    const known = this.#knownChats.get(remoteId);
    if (!known || (known.title !== remoteId && known.title !== 'WhatsApp contact')) return;
    const updated = { ...known, title: extractPhoneFromJid(canonicalPhoneJid) };
    this.#knownChats.set(remoteId, updated);
    this.#emit({ type: 'chat.upserted', chat: updated });
  }

  #cleanupSocket(): void {
    const socket = this.#socket;
    if (!socket) return;

    socket.ev.removeAllListeners('connection.update');
    socket.ev.removeAllListeners('chats.upsert');
    socket.ev.removeAllListeners('chats.update');
    socket.ev.removeAllListeners('chats.phoneNumberShare');
    socket.ev.removeAllListeners('contacts.upsert');
    socket.ev.removeAllListeners('contacts.update');
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
