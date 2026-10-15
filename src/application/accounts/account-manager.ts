import type { Account, AccountConnectionState, AccountId } from '../../domain';
import type { ManagedAccountSession } from './account-session';

interface AccountEntry {
  readonly account: Account;
  readonly session: ManagedAccountSession;
  readonly unsubscribe: () => void;
}

export interface ManagedAccount {
  readonly account: Account;
  readonly connectionState: AccountConnectionState;
}

export interface AccountManagerSnapshot {
  readonly accounts: readonly ManagedAccount[];
  readonly activeAccountId: AccountId | null;
}

export type AccountManagerListener = (snapshot: AccountManagerSnapshot) => void;

export class AccountManagerError extends Error {
  readonly code: 'duplicate-account' | 'missing-account' | 'session-account-mismatch';

  constructor(code: AccountManagerError['code'], message: string) {
    super(message);
    this.name = 'AccountManagerError';
    this.code = code;
  }
}

export class AccountManager {
  readonly #entries = new Map<AccountId, AccountEntry>();
  readonly #listeners = new Set<AccountManagerListener>();
  #activeAccountId: AccountId | null = null;

  addAccount(account: Account, session: ManagedAccountSession): void {
    if (account.id !== session.accountId) {
      throw new AccountManagerError(
        'session-account-mismatch',
        `Session does not belong to account ${account.id}`,
      );
    }
    if (this.#entries.has(account.id)) {
      throw new AccountManagerError('duplicate-account', `Account ${account.id} already exists`);
    }

    const unsubscribe = session.subscribe(() => this.#publish());
    this.#entries.set(account.id, { account, session, unsubscribe });
    this.#activeAccountId ??= account.id;
    this.#publish();
  }

  async removeAccount(accountId: AccountId): Promise<void> {
    const entry = this.#getEntry(accountId);
    await entry.session.disconnect('account-removed');
    entry.unsubscribe();
    this.#entries.delete(accountId);

    if (this.#activeAccountId === accountId) {
      this.#activeAccountId = this.#entries.keys().next().value ?? null;
    }
    this.#publish();
  }

  selectAccount(accountId: AccountId): void {
    this.#getEntry(accountId);
    this.#activeAccountId = accountId;
    this.#publish();
  }

  async connect(accountId: AccountId): Promise<void> {
    await this.#getEntry(accountId).session.connect();
  }

  async disconnect(accountId: AccountId, reason?: string): Promise<void> {
    await this.#getEntry(accountId).session.disconnect(reason);
  }

  async connectAll(): Promise<readonly PromiseSettledResult<void>[]> {
    return Promise.allSettled([...this.#entries.values()].map(({ session }) => session.connect()));
  }

  getSnapshot(): AccountManagerSnapshot {
    return {
      accounts: [...this.#entries.values()].map(({ account, session }) => ({
        account,
        connectionState: session.getState(),
      })),
      activeAccountId: this.#activeAccountId,
    };
  }

  subscribe(listener: AccountManagerListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #getEntry(accountId: AccountId): AccountEntry {
    const entry = this.#entries.get(accountId);
    if (!entry) {
      throw new AccountManagerError('missing-account', `Account ${accountId} does not exist`);
    }
    return entry;
  }

  #publish(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
