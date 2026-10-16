import { describe, expect, it, vi } from 'vitest';
import type {
  MessagingEvent,
  ProviderConnectionState,
} from '../../src/application/ports/messaging-provider';
import { createAccountId } from '../../src/domain';
import { MockMessagingSession } from '../../src/infrastructure/messaging/mock';

function pairingValues(events: readonly MessagingEvent[]): string[] {
  const values: string[] = [];
  for (const event of events) {
    if (event.type === 'pairing.qr') values.push(event.payload);
    if (event.type === 'pairing.code') values.push(event.code);
  }
  return values;
}

function connectionKinds(events: readonly MessagingEvent[]): ProviderConnectionState['kind'][] {
  const kinds: ProviderConnectionState['kind'][] = [];
  for (const event of events) {
    if (event.type === 'connection.changed') kinds.push(event.state.kind);
  }
  return kinds;
}
describe('MockMessagingSession', () => {
  it('simulates pairing, connection, incoming/outgoing messages, reconnect, and logout', async () => {
    const accountId = createAccountId('mock-provider');
    const session = new MockMessagingSession(accountId, { paired: false, now: () => 100 });
    const events: MessagingEvent[] = [];
    session.subscribe((event) => events.push(event));

    await expect(session.connect()).rejects.toMatchObject({ code: 'pairing-required' });
    expect(events.some(({ type }) => type === 'pairing.code')).toBe(true);
    expect(session.getConnectionState().kind).toBe('needsPairing');

    await session.simulatePairingSuccess();
    expect(session.getConnectionState().kind).toBe('connected');

    session.simulateChat({
      remoteId: 'friend@remote',
      kind: 'direct',
      title: 'Friend',
      unreadCount: 0,
    });
    session.simulateIncomingMessage({
      remoteId: 'incoming-1',
      chatRemoteId: 'friend@remote',
      sentAt: 101,
      content: { kind: 'text', text: 'Incoming' },
    });
    const outgoing = await session.sendText({ chatRemoteId: 'friend@remote', text: 'Outgoing' });
    expect(outgoing.direction).toBe('outgoing');
    expect(events.filter(({ type }) => type === 'message.upserted')).toHaveLength(2);

    await session.simulateReconnect();
    expect(session.getConnectionState().kind).toBe('connected');
    expect(
      events.some(
        (event) =>
          event.type === 'connection.changed' &&
          event.state.kind === 'disconnected' &&
          event.state.reason === 'connection-lost',
      ),
    ).toBe(true);

    await session.logout();
    expect(session.getConnectionState().kind).toBe('needsPairing');
  });

  it('rejects messaging while disconnected and isolates listeners after unsubscribe', async () => {
    const session = new MockMessagingSession(createAccountId('offline'));
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    unsubscribe();

    await expect(
      session.sendText({ chatRemoteId: 'friend@remote', text: 'Nope' }),
    ).rejects.toMatchObject({ code: 'not-connected' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('emits pairing.qr before pairing.code on every pairing attempt', async () => {
    const accountId = createAccountId('pairing');
    const session = new MockMessagingSession(accountId, { paired: false, now: () => 100 });
    const events: MessagingEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.startPairing();
    await session.startPairing();

    expect(connectionKinds(events)).toEqual(['needsPairing']);
    expect(pairingValues(events)).toEqual([
      `mock-qr:${accountId}:1`,
      `mock-qr:${accountId}`,
      `mock-qr:${accountId}:2`,
      `mock-qr:${accountId}`,
    ]);
  });

  it('announces disconnected before needsPairing when pairing restarts', async () => {
    const session = new MockMessagingSession(createAccountId('restart'), { now: () => 100 });
    await session.connect();

    const events: MessagingEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.startPairing();

    expect(connectionKinds(events)).toEqual(['disconnected', 'needsPairing']);
    expect(session.getConnectionState().kind).toBe('needsPairing');
    await expect(session.connect()).rejects.toMatchObject({ code: 'pairing-required' });
  });

  it('disposes idempotently and rejects further use', async () => {
    const session = new MockMessagingSession(createAccountId('disposed'));
    const listener = vi.fn();
    session.subscribe(listener);

    session.dispose();
    session.dispose();

    await expect(session.connect()).rejects.toMatchObject({ code: 'session-disposed' });
    await expect(session.startPairing()).rejects.toMatchObject({ code: 'session-disposed' });
    await expect(session.simulatePairingSuccess()).rejects.toMatchObject({
      code: 'session-disposed',
    });
    await expect(
      session.sendText({ chatRemoteId: 'friend@remote', text: 'Nope' }),
    ).rejects.toMatchObject({ code: 'session-disposed' });

    await session.disconnect('late');
    await session.logout();
    session.simulateChat({
      remoteId: 'friend@remote',
      kind: 'direct',
      title: 'Friend',
      unreadCount: 0,
    });

    expect(listener).not.toHaveBeenCalled();
    expect(session.getConnectionState().kind).toBe('idle');
  });
});
