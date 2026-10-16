import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MessagingEvent,
  ProviderConnectionState,
} from '../../src/application/ports/messaging-provider';
import { createAccountId } from '../../src/domain';
import { WhatsappMessagingSession } from '../../src/infrastructure/messaging/whatsapp/whatsapp-messaging-session';

type EventHandler = (...args: unknown[]) => void;

interface FakeSocket {
  readonly id: number;
  readonly pairingCodeRequests: string[];
  readonly sentTexts: string[];
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
  sendMessage(
    jid: string,
    content: { text?: string },
    options?: Record<string, unknown>,
  ): Promise<{ key: { id: string; remoteJid: string; fromMe: boolean } }>;
}

const harness = vi.hoisted(() => {
  const sockets: FakeSocket[] = [];
  const authStateDirs: string[] = [];
  const counters = { saveCredsCalls: 0, versionCalls: 0, authFailures: 0 };

  const createSocket = (): FakeSocket => {
    const handlers = new Map<string, EventHandler[]>();
    const socket: FakeSocket = {
      id: sockets.length + 1,
      pairingCodeRequests: [],
      sentTexts: [],
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
        socket.pairingCodeRequests.push(requestedNumber);
        return Promise.resolve('PAIR-CODE');
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
    counters,
    makeWASocket: () => createSocket(),
    useMultiFileAuthState: (dir: string) => {
      authStateDirs.push(dir);
      if (counters.authFailures > 0) {
        counters.authFailures -= 1;
        return Promise.reject(new Error('auth state unavailable'));
      }
      return Promise.resolve({
        state: {},
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
}));

const accountId = createAccountId('test-account');
const phoneNumber = '+33612345678';

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
    harness.counters.saveCredsCalls = 0;
    harness.counters.versionCalls = 0;
    harness.counters.authFailures = 0;
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
    it('opens a socket and waits for a QR payload when no phone number is known', async () => {
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

    it('requests a pairing code when a phone number is known', async () => {
      const session = new WhatsappMessagingSession(accountId, authDir, { phoneNumber });
      const events = collectEvents(session);
      const startedAt = Date.now();

      await session.startPairing();

      expect(requireSocket(0).pairingCodeRequests).toEqual([phoneNumber]);
      const codeEvent = events.find((event) => event.type === 'pairing.code');
      if (!codeEvent || codeEvent.type !== 'pairing.code') {
        throw new Error('Expected a pairing.code event');
      }
      expect(codeEvent.accountId).toBe(accountId);
      expect(codeEvent.code).toBe('PAIR-CODE');
      expect(codeEvent.expiresAt).toBe(startedAt + 5 * 60_000);
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
});
