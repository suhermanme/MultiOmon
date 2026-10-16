import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MessagingEvent,
  ProviderChat,
  ProviderConnectionState,
} from '../../src/application/ports/messaging-provider';
import { createAccountId } from '../../src/domain';
import { WhatsappMessagingSession } from '../../src/infrastructure/messaging/whatsapp/whatsapp-messaging-session';

type EventHandler = (...args: unknown[]) => void;

interface FakeSocket {
  readonly id: number;
  readonly pairingCodeRequests: string[];
  readonly pairingSteps: string[];
  readonly sentTexts: string[];
  readonly historyRequests: Array<{
    count: number;
    key: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null };
    timestamp: number;
  }>;
  readonly ev: {
    on(event: string, handler: EventHandler): void;
    removeAllListeners(event: string): void;
  };
  ended: boolean;
  loggedOut: boolean;
  emit(event: string, ...args: unknown[]): void;
  end(reason?: unknown): void;
  logout(): Promise<void>;
  requestPairingCode(phoneNumber: string): Promise<string>;
  waitForSocketOpen(): Promise<void>;
  fetchMessageHistory(
    count: number,
    key: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null },
    timestamp: number,
  ): Promise<string>;
  sendMessage(
    jid: string,
    content: { text?: string },
    options?: Record<string, unknown>,
  ): Promise<{ key: { id: string; remoteJid: string; fromMe: boolean } }>;
}

const harness = vi.hoisted(() => {
  const sockets: FakeSocket[] = [];
  const authStateDirs: string[] = [];
  const authIdentity: { id?: string; lid?: string } = {};
  const counters = {
    saveCredsCalls: 0,
    versionCalls: 0,
    authFailures: 0,
    incompleteAuthLoads: 0,
  };

  const createSocket = (): FakeSocket => {
    const handlers = new Map<string, EventHandler[]>();
    const socket: FakeSocket = {
      id: sockets.length + 1,
      pairingCodeRequests: [],
      pairingSteps: [],
      sentTexts: [],
      historyRequests: [],
      ended: false,
      loggedOut: false,
      ev: {
        on: (event, handler) => {
          const existing = handlers.get(event);
          if (existing) {
            existing.push(handler);
            return;
          }
          handlers.set(event, [handler]);
        },
        removeAllListeners: (event) => {
          handlers.delete(event);
        },
      },
      emit: (event, ...args) => {
        for (const handler of handlers.get(event) ?? []) handler(...args);
      },
      end: () => {
        socket.ended = true;
      },
      logout: () => {
        socket.loggedOut = true;
        return Promise.resolve();
      },
      requestPairingCode: (requestedNumber) => {
        socket.pairingSteps.push('request-code');
        socket.pairingCodeRequests.push(requestedNumber);
        return Promise.resolve('PAIR-CODE');
      },
      waitForSocketOpen: () => {
        socket.pairingSteps.push('socket-open');
        return Promise.resolve();
      },
      fetchMessageHistory: (count, key, timestamp) => {
        socket.historyRequests.push({ count, key, timestamp });
        return Promise.resolve('history-request-1');
      },
      sendMessage: (jid, content) => {
        socket.sentTexts.push(content.text ?? '');
        return Promise.resolve({ key: { id: `fake-${socket.id}`, remoteJid: jid, fromMe: true } });
      },
    };
    sockets.push(socket);
    return socket;
  };

  return {
    sockets,
    authStateDirs,
    authIdentity,
    counters,
    makeWASocket: () => createSocket(),
    useMultiFileAuthState: (dir: string) => {
      authStateDirs.push(dir);
      if (counters.authFailures > 0) {
        counters.authFailures -= 1;
        return Promise.reject(new Error('auth state unavailable'));
      }
      const incomplete = counters.incompleteAuthLoads > 0;
      if (incomplete) counters.incompleteAuthLoads -= 1;
      return Promise.resolve({
        state: {
          creds: {
            registered: false,
            ...(authIdentity.id
              ? { me: { id: authIdentity.id, name: 'Test account', lid: authIdentity.lid } }
              : {}),
            ...(incomplete ? { me: { id: 'partial@s.whatsapp.net', name: 'Partial' } } : {}),
          },
        },
        saveCreds: () => {
          counters.saveCredsCalls += 1;
          return Promise.resolve();
        },
      });
    },
    fetchLatestBaileysVersion: () => {
      counters.versionCalls += 1;
      return Promise.resolve({ version: [2, 3000, 10] });
    },
  };
});

vi.mock('@whiskeysockets/baileys', () => ({
  makeWASocket: harness.makeWASocket,
  useMultiFileAuthState: harness.useMultiFileAuthState,
  fetchLatestBaileysVersion: harness.fetchLatestBaileysVersion,
  proto: {
    WebMessageInfo: {
      encode: () => ({ finish: () => new Uint8Array([1, 2, 3]) }),
      decode: () => ({}),
    },
  },
  downloadMediaMessage: () => Promise.resolve(Buffer.from('downloaded-media')),
}));

const accountId = createAccountId('test-account');
function requireSocket(index: number): FakeSocket {
  const socket = harness.sockets[index];
  if (!socket) throw new Error(`Expected a fake Baileys socket at index ${index}`);
  return socket;
}

function collectEvents(session: WhatsappMessagingSession): MessagingEvent[] {
  const events: MessagingEvent[] = [];
  session.subscribe((event) => events.push(event));
  return events;
}

function connectionKinds(events: readonly MessagingEvent[]): ProviderConnectionState['kind'][] {
  const kinds: ProviderConnectionState['kind'][] = [];
  for (const event of events) {
    if (event.type === 'connection.changed') kinds.push(event.state.kind);
  }
  return kinds;
}

function closeSocket(socket: FakeSocket, error?: Record<string, unknown>): void {
  socket.emit('connection.update', {
    connection: 'close',
    ...(error === undefined ? {} : { lastDisconnect: { error } }),
  });
}

function chatUpserts(events: readonly MessagingEvent[]): ProviderChat[] {
  return events.flatMap((event) => (event.type === 'chat.upserted' ? [event.chat] : []));
}

async function openConnectedSession(authDir: string): Promise<{
  session: WhatsappMessagingSession;
  events: MessagingEvent[];
}> {
  const session = new WhatsappMessagingSession(accountId, authDir);
  await session.connect();
  requireSocket(0).emit('connection.update', { connection: 'open' });
  const events = collectEvents(session);
  return { session, events };
}

describe('WhatsappMessagingSession', () => {
  let authDir = '';

  beforeEach(() => {
    vi.useFakeTimers();
    authDir = mkdtempSync(path.join(tmpdir(), 'multiomon-wa-auth-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(authDir, { recursive: true, force: true });
    harness.sockets.length = 0;
    harness.authStateDirs.length = 0;
    delete harness.authIdentity.id;
    delete harness.authIdentity.lid;
    harness.counters.saveCredsCalls = 0;
    harness.counters.versionCalls = 0;
    harness.counters.authFailures = 0;
    harness.counters.incompleteAuthLoads = 0;
  });

  describe('initial state', () => {
    it('starts in idle state', () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      const state = session.getConnectionState();
      expect(state.kind).toBe('idle');
      expect(typeof state.changedAt).toBe('number');
      expect(harness.sockets).toHaveLength(0);
    });

    it('exposes accountId', () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      expect(session.accountId).toBe(accountId);
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe function', () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      const unsubscribe = session.subscribe(() => {});
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });
  });

  describe('sendText without connection', () => {
    it('rejects with ProviderError when not connected', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await expect(
        session.sendText({ chatRemoteId: '123@s.whatsapp.net', text: 'hello' }),
      ).rejects.toMatchObject({ code: 'not-connected' });
    });

    it('rejects with ProviderError when message text is empty', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await expect(
        session.sendText({ chatRemoteId: '123@s.whatsapp.net', text: '' }),
      ).rejects.toMatchObject({ code: 'not-connected' });
    });
  });

  describe('startPairing', () => {
    it('opens a socket and waits for a QR payload', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      const events = collectEvents(session);

      await session.startPairing();

      expect(session.getConnectionState().kind).toBe('needsPairing');
      expect(harness.sockets).toHaveLength(1);
      expect(harness.authStateDirs).toEqual([path.join(authDir, accountId)]);
      expect(requireSocket(0).pairingCodeRequests).toEqual([]);
      expect(events.some((event) => event.type === 'pairing.code')).toBe(false);

      requireSocket(0).emit('connection.update', { qr: 'qr-payload-1' });

      expect(events).toContainEqual(
        expect.objectContaining({ type: 'pairing.qr', accountId, payload: 'qr-payload-1' }),
      );
    });

    it('does not invoke the separate phone-number pairing protocol', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      const events = collectEvents(session);

      await session.startPairing();

      expect(requireSocket(0).pairingSteps).toEqual([]);
      expect(requireSocket(0).pairingCodeRequests).toEqual([]);
      expect(events.some((event) => event.type === 'pairing.code')).toBe(false);
    });

    it('resets an incomplete unregistered identity before starting the QR flow', async () => {
      harness.counters.incompleteAuthLoads = 1;
      const session = new WhatsappMessagingSession(accountId, authDir);
      const events = collectEvents(session);

      await session.startPairing();

      const sessionDir = path.join(authDir, accountId);
      expect(harness.authStateDirs).toEqual([sessionDir, sessionDir]);
      expect(harness.sockets).toHaveLength(1);
      expect(requireSocket(0).pairingSteps).toEqual([]);
      expect(requireSocket(0).pairingCodeRequests).toEqual([]);

      requireSocket(0).emit('connection.update', { qr: 'fresh-qr-payload' });
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'pairing.qr', payload: 'fresh-qr-payload' }),
      );
    });

    it('announces disconnected before needsPairing when already connected', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();
      requireSocket(0).emit('connection.update', { connection: 'open' });
      const events = collectEvents(session);

      await session.startPairing();

      expect(connectionKinds(events)).toEqual(['disconnected', 'needsPairing']);
      expect(requireSocket(0).ended).toBe(true);
      expect(harness.sockets).toHaveLength(2);
    });
  });

  describe('connect after a failed pairing attempt', () => {
    it('rejects with pairing-required when the session is in needsPairing state', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.startPairing();

      await expect(session.connect()).rejects.toMatchObject({ code: 'pairing-required' });
      expect(session.getConnectionState().kind).toBe('needsPairing');
    });
  });

  describe('disconnect', () => {
    it('transitions to disconnected state', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.disconnect('test-reason');
      const state = session.getConnectionState();
      if (state.kind !== 'disconnected') {
        throw new Error(`Expected disconnected state, got ${state.kind}`);
      }
      expect(state.reason).toBe('test-reason');
      expect(typeof state.changedAt).toBe('number');
    });

    it('is idempotent - disconnecting twice does not throw', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.disconnect();
      await session.disconnect();
      expect(session.getConnectionState().kind).toBe('disconnected');
    });

    it('closes the socket and cancels a pending reconnect', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();
      closeSocket(requireSocket(0), { message: 'connection reset' });
      expect(session.getConnectionState().kind).toBe('disconnected');

      await session.disconnect('manual');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(harness.sockets).toHaveLength(1);
      expect(requireSocket(0).ended).toBe(true);
      expect(session.getConnectionState().kind).toBe('disconnected');
    });
  });

  describe('logout', () => {
    it('transitions to needsPairing state', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      const events = collectEvents(session);

      await session.logout();

      expect(connectionKinds(events)).toEqual(['disconnected', 'needsPairing']);
      expect(session.getConnectionState().kind).toBe('needsPairing');
    });

    it('drops the socket and clears stored credentials', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();
      requireSocket(0).emit('connection.update', { connection: 'open' });
      const events = collectEvents(session);

      await session.logout();

      expect(requireSocket(0).loggedOut).toBe(true);
      expect(requireSocket(0).ended).toBe(true);
      expect(connectionKinds(events)).toEqual(['disconnected', 'needsPairing']);
      expect(existsSync(path.join(authDir, accountId))).toBe(false);

      const saveCredsCalls = harness.counters.saveCredsCalls;
      requireSocket(0).emit('creds.update');
      expect(harness.counters.saveCredsCalls).toBe(saveCredsCalls);

      await session.startPairing();
      expect(harness.authStateDirs).toHaveLength(2);
      expect(harness.sockets).toHaveLength(2);
    });

    it('cancels a pending reconnect', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();
      closeSocket(requireSocket(0), { message: 'connection reset' });

      await session.logout();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(harness.sockets).toHaveLength(1);
      expect(session.getConnectionState().kind).toBe('needsPairing');
    });
  });

  describe('event emission', () => {
    it('emits connection.changed events on state transitions', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      const events = collectEvents(session);

      await session.disconnect('test');

      expect(events).toContainEqual(expect.objectContaining({ type: 'connection.changed' }));
    });

    it('emits connection.changed with correct state on disconnect', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      const events = collectEvents(session);

      await session.disconnect('test');

      expect(connectionKinds(events)).toEqual(['disconnected']);
    });

    it('announces connecting before connected when a paired socket opens', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      const events = collectEvents(session);

      await session.startPairing();
      requireSocket(0).emit('connection.update', { connection: 'open' });

      expect(connectionKinds(events)).toEqual(['needsPairing', 'connecting', 'connected']);
      expect(session.getConnectionState().kind).toBe('connected');
    });

    it('emits chat and message upserts from the socket', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      const events = collectEvents(session);

      await session.connect();
      requireSocket(0).emit('connection.update', { connection: 'open' });
      requireSocket(0).emit('chats.upsert', [{ id: '33612345678@s.whatsapp.net', name: 'Alice' }]);
      requireSocket(0).emit('messages.upsert', {
        messages: [
          {
            key: { id: 'msg-1', remoteJid: '33612345678@s.whatsapp.net', fromMe: false },
            message: { conversation: 'hello' },
            messageTimestamp: 1_700_000_000,
          },
        ],
      });

      const chatEvent = events.find((event) => event.type === 'chat.upserted');
      if (!chatEvent || chatEvent.type !== 'chat.upserted') {
        throw new Error('Expected a chat.upserted event');
      }
      expect(chatEvent.chat).toMatchObject({ remoteId: '33612345678', title: 'Alice' });

      const messageEvent = events.find((event) => event.type === 'message.upserted');
      if (!messageEvent || messageEvent.type !== 'message.upserted') {
        throw new Error('Expected a message.upserted event');
      }
      expect(messageEvent.message).toMatchObject({ remoteId: 'msg-1', direction: 'incoming' });
    });
  });

  describe('reconnection', () => {
    it('reconnects with exponential backoff after a transient close', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();

      const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
      for (const [index, delay] of delays.entries()) {
        closeSocket(requireSocket(index), { message: 'connection reset' });
        expect(session.getConnectionState().kind).toBe('disconnected');

        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(harness.sockets).toHaveLength(index + 1);

        await vi.advanceTimersByTimeAsync(1);
        expect(harness.sockets).toHaveLength(index + 2);
        expect(session.getConnectionState().kind).toBe('connecting');
      }
    });

    it('honors custom reconnect options', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir, {
        reconnect: { baseDelayMs: 100, maxDelayMs: 500, factor: 3 },
      });
      await session.connect();

      const delays = [100, 300, 500];
      for (const [index, delay] of delays.entries()) {
        closeSocket(requireSocket(index), { message: 'connection reset' });
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(harness.sockets).toHaveLength(index + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(harness.sockets).toHaveLength(index + 2);
      }
    });

    it('keeps backing off when a reconnect attempt fails to initialize', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();
      closeSocket(requireSocket(0), { message: 'connection reset' });
      const events = collectEvents(session);

      harness.counters.authFailures = 1;
      await vi.advanceTimersByTimeAsync(1_000);

      expect(connectionKinds(events)).toEqual(['connecting', 'disconnected']);
      expect(session.getConnectionState().kind).toBe('disconnected');
      expect(harness.sockets).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1_999);
      await vi.advanceTimersByTimeAsync(1);
      expect(harness.sockets).toHaveLength(2);
    });

    it('stops reconnecting when the socket closes with an authentication failure', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();
      closeSocket(requireSocket(0), {
        output: { statusCode: 401 },
        message: 'Authentication failure',
      });

      const state = session.getConnectionState();
      expect(state).toMatchObject({ kind: 'failed', errorCode: 'auth-failure' });

      await vi.advanceTimersByTimeAsync(120_000);
      expect(harness.sockets).toHaveLength(1);
    });

    it('cancels a pending reconnect when pairing is restarted', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();
      closeSocket(requireSocket(0), { message: 'connection reset' });

      await session.startPairing();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(harness.sockets).toHaveLength(2);
      expect(session.getConnectionState().kind).toBe('needsPairing');
    });
  });

  describe('sendText while connected', () => {
    it('sends through the socket and emits message.upserted', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();
      requireSocket(0).emit('connection.update', { connection: 'open' });
      const events = collectEvents(session);

      const message = await session.sendText({
        chatRemoteId: '33612345678@s.whatsapp.net',
        text: 'hello',
      });

      expect(requireSocket(0).sentTexts).toEqual(['hello']);
      expect(message.chatRemoteId).toBe('33612345678');
      expect(message.direction).toBe('outgoing');
      expect(events).toContainEqual(expect.objectContaining({ type: 'message.upserted' }));
    });

    it('rejects with invalid-message when the text is blank', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();
      requireSocket(0).emit('connection.update', { connection: 'open' });

      await expect(
        session.sendText({ chatRemoteId: '33612345678@s.whatsapp.net', text: '   ' }),
      ).rejects.toMatchObject({ code: 'invalid-message' });
    });
  });

  describe('dispose', () => {
    it('does not throw when called', () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      expect(() => session.dispose()).not.toThrow();
    });

    it('is idempotent and blocks further use', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();

      session.dispose();
      session.dispose();

      expect(requireSocket(0).ended).toBe(true);
      await expect(session.connect()).rejects.toMatchObject({ code: 'session-disposed' });
      await expect(session.startPairing()).rejects.toMatchObject({ code: 'session-disposed' });
      await expect(
        session.sendText({ chatRemoteId: '123@s.whatsapp.net', text: 'hello' }),
      ).rejects.toMatchObject({ code: 'session-disposed' });
    });

    it('cancels a pending reconnect and stops emitting events', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir);
      await session.connect();
      closeSocket(requireSocket(0), { message: 'connection reset' });
      const events = collectEvents(session);

      session.dispose();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(harness.sockets).toHaveLength(1);
      expect(events).toHaveLength(0);
    });
  });

  describe('history hydration', () => {
    it('uses the phone identity for a LID chat without changing its stable remote key', async () => {
      harness.authIdentity.id = '628111222333@s.whatsapp.net';
      harness.authIdentity.lid = '180900000000001:0@lid';
      const { events } = await openConnectedSession(authDir);

      requireSocket(0).emit('messaging-history.set', {
        chats: [{ id: '180900000000001@lid', unreadCount: 0 }],
        contacts: [],
        messages: [
          {
            key: {
              id: 'lid-message',
              remoteJid: '180900000000001@lid',
              participant: '180900000000001:1@lid',
              fromMe: false,
            },
            message: { conversation: 'hello from a LID chat' },
            messageTimestamp: 1_700_000_000,
          },
        ],
      });

      expect(chatUpserts(events)[0]).toMatchObject({
        remoteId: '180900000000001@lid',
        title: '628111222333',
      });
      const messageEvent = events.find((event) => event.type === 'message.upserted');
      expect(messageEvent).toMatchObject({
        message: { chatRemoteId: '180900000000001@lid', senderRemoteId: '628111222333' },
      });
    });

    it('does not project transport-control packets as unsupported messages', async () => {
      const { events } = await openConnectedSession(authDir);

      requireSocket(0).emit('messages.upsert', {
        messages: [
          {
            key: { id: 'protocol-1', remoteJid: '33612345678@s.whatsapp.net', fromMe: true },
            message: { protocolMessage: { type: 5 } },
            messageTimestamp: 1_700_000_000,
          },
          {
            key: { id: 'empty-1', remoteJid: '33612345678@s.whatsapp.net', fromMe: true },
            message: undefined,
            messageTimestamp: 1_700_000_001,
          },
        ],
      });

      expect(events.filter((event) => event.type === 'message.upserted')).toHaveLength(0);
    });

    it('maps messaging-history.set chats and messages onto normalized events', async () => {
      const { events } = await openConnectedSession(authDir);

      requireSocket(0).emit('messaging-history.set', {
        chats: [
          {
            id: '33612345678@s.whatsapp.net',
            name: 'Alice',
            unreadCount: 2,
            conversationTimestamp: 1_700_000_000,
          },
          { id: 'group-1@g.us', lastMessageRecvTimestamp: 1_700_000_500 },
        ],
        messages: [
          {
            key: { id: 'hist-1', remoteJid: '33612345678@s.whatsapp.net', fromMe: false },
            message: { conversation: 'History message' },
            messageTimestamp: 1_700_000_000,
          },
        ],
        isLatest: true,
      });

      expect(chatUpserts(events)).toEqual([
        {
          accountId,
          remoteId: '33612345678',
          kind: 'direct',
          title: 'Alice',
          unreadCount: 2,
          lastActivityAt: 1_700_000_000_000,
        },
        {
          accountId,
          remoteId: 'group-1@g.us',
          kind: 'group',
          title: 'Group group-1@g.us',
          unreadCount: 0,
          lastActivityAt: 1_700_000_500_000,
        },
      ]);
      const messageEvents = events.filter((event) => event.type === 'message.upserted');
      expect(messageEvents).toHaveLength(1);
      const historyMessage = messageEvents[0];
      if (historyMessage?.type !== 'message.upserted') {
        throw new Error('Expected a message.upserted event');
      }
      expect(historyMessage.message).toMatchObject({
        remoteId: 'hist-1',
        chatRemoteId: '33612345678',
        direction: 'incoming',
        sentAt: 1_700_000_000_000,
      });
    });

    it('omits lastActivityAt when a synced chat has no activity timestamp', async () => {
      const { events } = await openConnectedSession(authDir);

      requireSocket(0).emit('messaging-history.set', {
        chats: [{ id: '33612345678@s.whatsapp.net', name: 'Alice' }],
        messages: [],
      });

      expect(chatUpserts(events)[0]).not.toHaveProperty('lastActivityAt');
    });

    it('converts protobuf Long timestamps to milliseconds', async () => {
      const { events } = await openConnectedSession(authDir);
      const longTimestamp = {
        low: 1_700_000_000,
        high: 0,
        unsigned: false,
        valueOf: () => 1_700_000_000,
      };

      requireSocket(0).emit('chats.upsert', [
        { id: '33612345678@s.whatsapp.net', name: 'Alice', conversationTimestamp: longTimestamp },
      ]);

      expect(chatUpserts(events)[0]).toMatchObject({ lastActivityAt: 1_700_000_000_000 });
    });

    it('requests an older page using the oldest persisted message anchor', async () => {
      const { session } = await openConnectedSession(authDir);

      await session.requestHistory({
        chatRemoteId: '33612345678',
        oldestRemoteMessageId: 'oldest-1',
        oldestDirection: 'incoming',
        oldestSentAt: 1_700_000_000_000,
        count: 50,
      });

      expect(requireSocket(0).historyRequests).toEqual([
        {
          count: 50,
          key: {
            remoteJid: '33612345678@s.whatsapp.net',
            id: 'oldest-1',
            fromMe: false,
          },
          timestamp: 1_700_000_000_000,
        },
      ]);
    });

    it('normalizes media metadata and downloads the serialized provider message', async () => {
      const { session, events } = await openConnectedSession(authDir);

      requireSocket(0).emit('messages.upsert', {
        messages: [
          {
            key: {
              id: 'image-1',
              remoteJid: 'group-1@g.us',
              participant: '33612345678@s.whatsapp.net',
              fromMe: false,
            },
            message: {
              imageMessage: {
                mimetype: 'image/jpeg',
                fileLength: 123,
                caption: 'Holiday',
              },
            },
            messageTimestamp: 1_700_000_000,
          },
        ],
      });

      const event = events.find((candidate) => candidate.type === 'message.upserted');
      if (!event || event.type !== 'message.upserted' || event.message.content.kind !== 'media') {
        throw new Error('Expected normalized media message');
      }
      expect(event.message).toMatchObject({ senderRemoteId: '33612345678' });
      expect(event.message.content).toMatchObject({
        attachmentKind: 'image',
        mediaType: 'image/jpeg',
        sizeBytes: 123,
        caption: 'Holiday',
      });
      await expect(session.downloadMedia(event.message.content.remoteReference)).resolves.toEqual(
        new Uint8Array(Buffer.from('downloaded-media')),
      );
    });
  });

  describe('chats.update unread-delta merge', () => {
    it('adds positive deltas to the known base and clamps at zero', async () => {
      const { events } = await openConnectedSession(authDir);
      requireSocket(0).emit('messaging-history.set', {
        chats: [
          {
            id: '33612345678@s.whatsapp.net',
            name: 'Alice',
            unreadCount: 2,
            conversationTimestamp: 1_700_000_000,
          },
        ],
        messages: [],
      });

      requireSocket(0).emit('chats.update', [
        {
          id: '33612345678@s.whatsapp.net',
          unreadCount: 1,
          conversationTimestamp: 1_700_000_100,
        },
      ]);
      expect(chatUpserts(events).at(-1)).toMatchObject({
        unreadCount: 3,
        lastActivityAt: 1_700_000_100_000,
      });

      requireSocket(0).emit('chats.update', [
        { id: '33612345678@s.whatsapp.net', unreadCount: -5 },
      ]);
      expect(chatUpserts(events).at(-1)).toMatchObject({ unreadCount: 0 });
    });

    it('treats null and zero unreadCount as absolute mark-read', async () => {
      const { events } = await openConnectedSession(authDir);
      requireSocket(0).emit('messaging-history.set', {
        chats: [{ id: '33612345678@s.whatsapp.net', name: 'Alice', unreadCount: 4 }],
        messages: [],
      });

      requireSocket(0).emit('chats.update', [{ id: '33612345678@s.whatsapp.net', unreadCount: 0 }]);
      expect(chatUpserts(events).at(-1)).toMatchObject({ unreadCount: 0 });

      requireSocket(0).emit('chats.update', [{ id: '33612345678@s.whatsapp.net', unreadCount: 3 }]);
      requireSocket(0).emit('chats.update', [
        { id: '33612345678@s.whatsapp.net', unreadCount: null },
      ]);
      expect(chatUpserts(events).at(-1)).toMatchObject({ unreadCount: 0 });
    });

    it('keeps the base unreadCount when the update omits it', async () => {
      const { events } = await openConnectedSession(authDir);
      requireSocket(0).emit('messaging-history.set', {
        chats: [{ id: '33612345678@s.whatsapp.net', name: 'Alice', unreadCount: 2 }],
        messages: [],
      });

      requireSocket(0).emit('chats.update', [
        { id: '33612345678@s.whatsapp.net', name: 'Renamed' },
      ]);

      expect(chatUpserts(events).at(-1)).toMatchObject({ unreadCount: 2, title: 'Renamed' });
    });

    it('treats protobuf Long unreadCount as absolute', async () => {
      const { events } = await openConnectedSession(authDir);
      requireSocket(0).emit('messaging-history.set', {
        chats: [{ id: '33612345678@s.whatsapp.net', name: 'Alice', unreadCount: 2 }],
        messages: [],
      });

      requireSocket(0).emit('chats.update', [
        {
          id: '33612345678@s.whatsapp.net',
          unreadCount: { low: 7, high: 0, unsigned: false, valueOf: () => 7 },
        },
      ]);

      expect(chatUpserts(events).at(-1)).toMatchObject({ unreadCount: 7 });
    });

    it('falls back to a zero base for updates about unknown chats', async () => {
      const { events } = await openConnectedSession(authDir);

      requireSocket(0).emit('chats.update', [
        { id: '33698765432@s.whatsapp.net', unreadCount: 1, lastMsgTimestamp: 1_700_000_200 },
      ]);

      expect(chatUpserts(events).at(-1)).toEqual({
        accountId,
        remoteId: '33698765432',
        kind: 'direct',
        title: '33698765432',
        unreadCount: 1,
        lastActivityAt: 1_700_000_200_000,
      });
    });

    it('keeps known chat bases across reconnects', async () => {
      const { session, events } = await openConnectedSession(authDir);
      requireSocket(0).emit('messaging-history.set', {
        chats: [{ id: '33612345678@s.whatsapp.net', name: 'Alice', unreadCount: 2 }],
        messages: [],
      });

      closeSocket(requireSocket(0), { message: 'connection reset' });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(harness.sockets).toHaveLength(2);
      requireSocket(1).emit('connection.update', { connection: 'open' });

      requireSocket(1).emit('chats.update', [{ id: '33612345678@s.whatsapp.net', unreadCount: 1 }]);

      expect(chatUpserts(events).at(-1)).toMatchObject({ unreadCount: 3 });
      expect(session.getConnectionState().kind).toBe('connected');
    });
  });
});
