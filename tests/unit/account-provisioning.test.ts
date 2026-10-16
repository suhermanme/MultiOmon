import { describe, expect, it } from 'vitest';
import { AccountManager } from '../../src/application/accounts/account-manager';
import {
  AccountProvisioningError,
  AccountProvisioningService,
} from '../../src/application/accounts/account-provisioning';
import { MessagingService } from '../../src/application/messaging/messaging-service';
import type {
  MessagingEventListener,
  MessagingProvider,
  MessagingSession,
  ProviderConnectionState,
  ProviderMessage,
  SendTextRequest,
  Unsubscribe,
} from '../../src/application/ports/messaging-provider';
import type {
  AccountRepository,
  RepositoryBundle,
  TransactionRunner,
} from '../../src/application/ports/repositories';
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

class FakeMessagingSession implements MessagingSession {
  readonly calls: string[] = [];
  disposeCount = 0;
  #state: ProviderConnectionState = { kind: 'idle', changedAt: 0 };
  readonly #listeners = new Set<MessagingEventListener>();

  constructor(readonly accountId: AccountId) {}

  getConnectionState(): ProviderConnectionState {
    return this.#state;
  }

  startPairing(): Promise<void> {
    this.calls.push('startPairing');
    this.#emit({ kind: 'needsPairing', changedAt: 1 });
    return Promise.resolve();
  }

  connect(): Promise<void> {
    this.calls.push('connect');
    this.#emit({ kind: 'connecting', changedAt: 2, attempt: 1 });
    this.#emit({ kind: 'connected', changedAt: 3, connectedAt: 3 });
    return Promise.resolve();
  }

  disconnect(reason?: string): Promise<void> {
    this.calls.push('disconnect');
    this.#emit({
      kind: 'disconnected',
      changedAt: 4,
      ...(reason === undefined ? {} : { reason }),
    });
    return Promise.resolve();
  }

  logout(): Promise<void> {
    this.calls.push('logout');
    this.#emit({ kind: 'disconnected', changedAt: 5, reason: 'logout' });
    return Promise.resolve();
  }

  sendText(request: SendTextRequest): Promise<ProviderMessage> {
    return Promise.reject(new Error(`Unexpected sendText for ${request.chatRemoteId}`));
  }

  subscribe(listener: MessagingEventListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.disposeCount += 1;
  }

  #emit(state: ProviderConnectionState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener({ type: 'connection.changed', state });
    }
  }
}

class FakeMessagingProvider implements MessagingProvider {
  readonly sessions: FakeMessagingSession[] = [];
  #failNextSessionCreation = false;

  failNextSessionCreation(): void {
    this.#failNextSessionCreation = true;
  }

  createSession(accountId: AccountId): MessagingSession {
    if (this.#failNextSessionCreation) {
      this.#failNextSessionCreation = false;
      throw new Error('provider unavailable');
    }
    const session = new FakeMessagingSession(accountId);
    this.sessions.push(session);
    return session;
  }
}

const transactionRunner: TransactionRunner = {
  runInTransaction<T>(work: () => T): T {
    return work();
  },
};

function createHarness(options: { mintAccountId?: () => AccountId } = {}) {
  const accounts = new InMemoryAccountRepository();
  const provider = new FakeMessagingProvider();
  const messaging = new MessagingService(provider, transactionRunner, {
    accounts,
    chats: {
      save: () => undefined,
      getById: () => null,
      getByRemoteId: () => null,
      listByAccount: () => [],
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
      listPage: () => ({ items: [], nextCursor: null }),
    },
  } satisfies RepositoryBundle);
  const accountManager = new AccountManager();
  let counter = 0;
  const provisioning = new AccountProvisioningService({
    accounts,
    accountManager,
    messaging,
    mintAccountId:
      options.mintAccountId ??
      (() => {
        counter += 1;
        return createAccountId(`account-${counter}`);
      }),
    now: () => 1_000,
  });

  return { accounts, provider, messaging, accountManager, provisioning };
}

function connectionKinds(accountManager: AccountManager): readonly string[] {
  return accountManager.getSnapshot().accounts.map(({ connectionState }) => connectionState.kind);
}

describe('AccountProvisioningService', () => {
  it('persists the account and registers a live session for it', () => {
    const { accounts, messaging, accountManager, provisioning } = createHarness();

    const created = provisioning.createAccount({
      displayName: '  Personal  ',
      phoneNumber: '+33 6 12 34 56 78',
    });

    expect(created).toEqual({
      id: createAccountId('account-1'),
      displayName: 'Personal',
      createdAt: 1_000,
      phoneNumber: '+33612345678',
    });
    expect(accounts.getById(created.id)).toEqual(created);
    expect(messaging.hasAccountSession(created.id)).toBe(true);
    expect(accountManager.hasAccount(created.id)).toBe(true);
    expect(connectionKinds(accountManager)).toEqual(['idle']);
  });

  it('omits the phone number when it is blank after trimming', () => {
    const { provisioning } = createHarness();

    const created = provisioning.createAccount({ displayName: 'Work', phoneNumber: '   ' });

    expect(created.phoneNumber).toBeUndefined();
    expect('phoneNumber' in created).toBe(false);
  });

  it('rejects blank or oversized display names without persisting them', () => {
    const { accounts, provisioning } = createHarness();

    for (const displayName of ['', '   ', '\t\n']) {
      expect(() => provisioning.createAccount({ displayName })).toThrow(AccountProvisioningError);
    }
    expect(() => provisioning.createAccount({ displayName: 'x'.repeat(65) })).toThrow(
      AccountProvisioningError,
    );
    try {
      provisioning.createAccount({ displayName: '' });
    } catch (error) {
      expect(error).toBeInstanceOf(AccountProvisioningError);
      expect((error as AccountProvisioningError).code).toBe('invalid-display-name');
    }
    expect(accounts.list()).toHaveLength(0);
  });

  it('normalizes separators and rejects malformed phone numbers', () => {
    const { provisioning } = createHarness();

    expect(
      provisioning.createAccount({ displayName: 'A', phoneNumber: '0033 (0)6-1234' }).phoneNumber,
    ).toBe('0033061234');
    expect(
      provisioning.createAccount({ displayName: 'B', phoneNumber: '()' }).phoneNumber,
    ).toBeUndefined();

    for (const phoneNumber of ['not-a-phone', '1234', '+33 6 12 34 56 78 90 12 34']) {
      let thrown: unknown;
      try {
        provisioning.createAccount({ displayName: 'C', phoneNumber });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AccountProvisioningError);
      expect((thrown as AccountProvisioningError).code).toBe('invalid-phone-number');
    }
  });

  it('drops the persisted row when the live session cannot be created', () => {
    const { accounts, accountManager, messaging, provider, provisioning } = createHarness();
    provider.failNextSessionCreation();

    expect(() => provisioning.createAccount({ displayName: 'Broken' })).toThrow(
      'provider unavailable',
    );

    expect(accounts.list()).toHaveLength(0);
    expect(accountManager.hasAccount(createAccountId('account-1'))).toBe(false);
    expect(messaging.hasAccountSession(createAccountId('account-1'))).toBe(false);
  });

  it('restores persisted accounts once and skips already-managed ones', () => {
    const { accounts, accountManager, provisioning } = createHarness();
    accounts.save({ id: createAccountId('stored-1'), displayName: 'Stored 1', createdAt: 1 });
    accounts.save({
      id: createAccountId('stored-2'),
      displayName: 'Stored 2',
      createdAt: 2,
      phoneNumber: '+33612345678',
    });

    const restored = provisioning.restoreAccounts();

    expect(restored.map((account) => account.id)).toEqual([
      createAccountId('stored-1'),
      createAccountId('stored-2'),
    ]);
    expect(accountManager.hasAccount(createAccountId('stored-2'))).toBe(true);
    expect(connectionKinds(accountManager)).toEqual(['idle', 'idle']);
    expect(provisioning.restoreAccounts()).toHaveLength(0);
  });

  it('removes an account from the projection, the manager and the session set', async () => {
    const { accounts, accountManager, messaging, provider, provisioning } = createHarness();
    const created = provisioning.createAccount({ displayName: 'Personal' });

    await provisioning.removeAccount(created.id);

    expect(accounts.getById(created.id)).toBeNull();
    expect(accountManager.hasAccount(created.id)).toBe(false);
    expect(messaging.hasAccountSession(created.id)).toBe(false);
    expect(provider.sessions[0]?.calls).toEqual(['disconnect']);
    expect(provider.sessions[0]?.disposeCount).toBe(1);
  });

  it('removes a persisted account that has no live session', async () => {
    const { accounts, provisioning } = createHarness();
    accounts.save({ id: createAccountId('orphan'), displayName: 'Orphan', createdAt: 1 });

    await provisioning.removeAccount(createAccountId('orphan'));

    expect(accounts.list()).toHaveLength(0);
  });

  it('drives pairing and connect through the managed session', async () => {
    const { accountManager, provisioning } = createHarness();
    const created = provisioning.createAccount({ displayName: 'Personal' });

    await provisioning.startPairing(created.id);
    expect(connectionKinds(accountManager)).toEqual(['needsPairing']);

    await provisioning.connectAccount(created.id);
    expect(connectionKinds(accountManager)).toEqual(['connected']);

    await provisioning.logoutAccount(created.id);
    expect(connectionKinds(accountManager)).toEqual(['disconnected']);
  });

  it('rejects lifecycle commands for accounts that are not registered', async () => {
    const { provisioning } = createHarness();
    const missing = createAccountId('ghost');

    for (const command of [
      () => provisioning.logoutAccount(missing),
      () => provisioning.startPairing(missing),
      () => provisioning.connectAccount(missing),
    ]) {
      await expect(command()).rejects.toBeInstanceOf(AccountProvisioningError);
    }

    try {
      await provisioning.startPairing(missing);
    } catch (error) {
      expect((error as AccountProvisioningError).code).toBe('missing-account');
    }
  });
});
