import { describe, expect, it } from 'vitest';
import { AccountManager } from '../../src/application/accounts/account-manager';
import { AccountProvisioningService } from '../../src/application/accounts/account-provisioning';
import {
  MessagingApplicationError,
  MessagingService,
  type PairingEvent,
} from '../../src/application/messaging/messaging-service';
import type {
  MessagingEventListener,
  MessagingEvent,
  MessagingProvider,
  MessagingSession,
  ProviderConnectionState,
  ProviderMessage,
  SendTextRequest,
  Unsubscribe,
} from '../../src/application/ports/messaging-provider';
import type { AccountRepository } from '../../src/application/ports/repositories';
import { createAccountId, type Account, type AccountId } from '../../src/domain';

class InMemoryAccountRepository implements AccountRepository {
  readonly #rows = new Map<AccountId, Account>();

  save(account: Account): void {
    this.#rows.set(account.id, { ...account });
  }

  getById(accountId: AccountId): Account | null {
    const row = this.#rows.get(accountId);
    return row ? { ...row } : null;
  }

  list(): readonly Account[] {
    return [...this.#rows.values()].map((row) => ({ ...row }));
  }

  delete(accountId: AccountId): void {
    this.#rows.delete(accountId);
  }
}

class PairingSession implements MessagingSession {
  readonly #listeners = new Set<MessagingEventListener>();
  #state: ProviderConnectionState = { kind: 'idle', changedAt: 0 };

  constructor(readonly accountId: AccountId) {}

  getConnectionState(): ProviderConnectionState {
    return this.#state;
  }

  startPairing(): Promise<void> {
    this.#emit({ kind: 'disconnected', changedAt: 1, reason: 'pairing-requested' });
    this.#emit({ kind: 'needsPairing', changedAt: 2 });
    return Promise.resolve();
  }

  connect(): Promise<void> {
    this.#emit({ kind: 'connecting', changedAt: 3, attempt: 1 });
    this.#emit({ kind: 'connected', changedAt: 4, connectedAt: 4 });
    return Promise.resolve();
  }

  disconnect(reason?: string): Promise<void> {
    this.#emit({
      kind: 'disconnected',
      changedAt: 5,
      ...(reason === undefined ? {} : { reason }),
    });
    return Promise.resolve();
  }

  logout(): Promise<void> {
    this.#emit({ kind: 'disconnected', changedAt: 6, reason: 'logout' });
    return Promise.resolve();
  }

  sendText(request: SendTextRequest): Promise<ProviderMessage> {
    return Promise.reject(new Error(`Unexpected sendText for ${request.chatRemoteId}`));
  }

  markRead(): Promise<void> {
    return Promise.resolve();
  }

  requestHistory(): Promise<void> {
    return Promise.resolve();
  }

  downloadMedia(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }

  subscribe(listener: MessagingEventListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#listeners.clear();
  }

  publish(event: MessagingEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  #emit(state: ProviderConnectionState): void {
    this.#state = state;
    this.publish({ type: 'connection.changed', state });
  }
}

class PairingProvider implements MessagingProvider {
  readonly sessions = new Map<AccountId, PairingSession>();

  createSession(accountId: AccountId): MessagingSession {
    const existing = this.sessions.get(accountId);
    if (existing) return existing;
    const session = new PairingSession(accountId);
    this.sessions.set(accountId, session);
    return session;
  }
}

function createHarness() {
  const accounts = new InMemoryAccountRepository();
  const provider = new PairingProvider();
  const transactionRunner = {
    runInTransaction<T>(work: () => T): T {
      return work();
    },
  };
  const messaging = new MessagingService(provider, transactionRunner, {
    accounts,
    attachments: {
      save: () => undefined,
      getById: () => null,
    },
    chats: {
      save: () => undefined,
      getById: () => null,
      getByRemoteId: () => null,
      listPage: () => ({ items: [], nextCursor: null }),
    },
    contacts: {
      save: () => undefined,
      getById: () => null,
      getByRemoteId: () => null,
      listByAccount: () => [],
    },
    messages: {
      insert: () => true,
      getById: () => null,
      getByRemoteId: () => null,
      getOldestByChat: () => null,
      listPage: () => ({ items: [], nextCursor: null }),
    },
    receipts: {
      save: () => undefined,
      listByMessage: () => [],
    },
  });
  const accountManager = new AccountManager();
  const provisioning = new AccountProvisioningService({
    accounts,
    accountManager,
    messaging,
    mintAccountId: () => createAccountId('pairing-account'),
    now: () => 1,
  });

  return { accounts, provider, messaging, accountManager, provisioning };
}

describe('account pairing flow', () => {
  it('fans pairing code and QR events out to pairing subscribers', async () => {
    const { provider, messaging, provisioning } = createHarness();
    const received: PairingEvent[] = [];
    messaging.subscribePairing((event) => received.push(event));

    const account = provisioning.createAccount({ displayName: 'Personal' });
    await provisioning.startPairing(account.id);

    const session = provider.sessions.get(account.id)!;
    session.publish({ type: 'pairing.qr', accountId: account.id, payload: '1@abc#def' });
    session.publish({
      type: 'pairing.code',
      accountId: account.id,
      code: 'ABCDEF',
      expiresAt: 2_000,
    });

    expect(received).toEqual([
      { type: 'pairing.qr', accountId: account.id, payload: '1@abc#def' },
      { type: 'pairing.code', accountId: account.id, code: 'ABCDEF', expiresAt: 2_000 },
    ]);
  });

  it('stops delivering pairing events once the subscription is cancelled', () => {
    const { provider, messaging } = createHarness();
    const accountId = createAccountId('pairing-account');
    const session = new PairingSession(accountId);
    provider.sessions.set(accountId, session);
    messaging.createAccountSession(accountId);

    const received: PairingEvent[] = [];
    const unsubscribe = messaging.subscribePairing((event) => received.push(event));
    session.publish({ type: 'pairing.qr', accountId, payload: 'first' });
    unsubscribe();
    session.publish({ type: 'pairing.qr', accountId, payload: 'second' });

    expect(
      received.map((event) => (event.type === 'pairing.qr' ? event.payload : event.code)),
    ).toEqual(['first']);
  });

  it('rejects pairing events that belong to another account', () => {
    const { provider, messaging } = createHarness();
    const accountId = createAccountId('pairing-account');
    const session = new PairingSession(accountId);
    provider.sessions.set(accountId, session);
    messaging.createAccountSession(accountId);

    expect(() =>
      session.publish({
        type: 'pairing.code',
        accountId: createAccountId('other-account'),
        code: 'WRONG',
        expiresAt: 1,
      }),
    ).toThrow(MessagingApplicationError);
  });

  it('stops pairing fan-out when the account session is removed', async () => {
    const { provider, messaging, provisioning } = createHarness();
    const received: PairingEvent[] = [];
    messaging.subscribePairing((event) => received.push(event));

    const account = provisioning.createAccount({ displayName: 'Personal' });
    const session = provider.sessions.get(account.id)!;
    session.publish({ type: 'pairing.qr', accountId: account.id, payload: 'before' });

    await provisioning.removeAccount(account.id);
    session.publish({ type: 'pairing.qr', accountId: account.id, payload: 'after' });

    expect(
      received.filter((event) => event.type === 'pairing.qr').map((event) => event.payload),
    ).toEqual(['before']);
  });
});
