import { describe, expect, it, vi } from 'vitest';
import type { MessagingEvent } from '../../src/application/ports/messaging-provider';
import { createAccountId } from '../../src/domain';
import { MockMessagingSession } from '../../src/infrastructure/messaging/mock';

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
});
