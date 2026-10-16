import {
  transitionConnectionState,
  type AccountConnectionState,
  type AccountId,
} from '../../domain';

export type AccountSessionListener = (state: AccountConnectionState) => void;

export interface ManagedAccountSession {
  readonly accountId: AccountId;
  getState(): AccountConnectionState;
  startPairing(): Promise<void>;
  connect(): Promise<void>;
  disconnect(reason?: string): Promise<void>;
  logout(): Promise<void>;
  dispose(): void;
  subscribe(listener: AccountSessionListener): () => void;
}

export interface InMemorySessionOptions {
  readonly failConnectionWith?: { readonly code: string; readonly message: string };
}

export class InMemoryAccountSession implements ManagedAccountSession {
  readonly accountId: AccountId;
  readonly #listeners = new Set<AccountSessionListener>();
  readonly #options: InMemorySessionOptions;
  #state: AccountConnectionState;
  #attempt = 0;

  constructor(accountId: AccountId, options: InMemorySessionOptions = {}) {
    this.accountId = accountId;
    this.#options = options;
    this.#state = { kind: 'idle', changedAt: Date.now() };
  }

  getState(): AccountConnectionState {
    return this.#state;
  }

  async startPairing(): Promise<void> {
    if (this.#state.kind === 'connected' || this.#state.kind === 'connecting') {
      await this.disconnect('pairing-requested');
    }
    if (this.#state.kind !== 'needsPairing') {
      this.#setState({ kind: 'needsPairing', changedAt: Date.now() });
    }
    this.#attempt = 0;
  }

  async connect(): Promise<void> {
    if (this.#state.kind === 'connected') return;
    this.#attempt += 1;
    this.#setState({ kind: 'connecting', changedAt: Date.now(), attempt: this.#attempt });
    await Promise.resolve();

    if (this.#options.failConnectionWith) {
      const failure = this.#options.failConnectionWith;
      this.#setState({
        kind: 'failed',
        changedAt: Date.now(),
        errorCode: failure.code,
        message: failure.message,
      });
      throw new Error(failure.message);
    }

    const connectedAt = Date.now();
    this.#setState({ kind: 'connected', changedAt: connectedAt, connectedAt });
  }

  async disconnect(reason?: string): Promise<void> {
    if (this.#state.kind === 'disconnected') return;
    this.#setState({ kind: 'disconnected', changedAt: Date.now(), reason });
    await Promise.resolve();
  }

  async logout(): Promise<void> {
    if (this.#state.kind !== 'idle' && this.#state.kind !== 'disconnected') {
      this.#setState({ kind: 'disconnected', changedAt: Date.now(), reason: 'logged-out' });
    }
    if (this.#state.kind !== 'needsPairing') {
      this.#setState({ kind: 'needsPairing', changedAt: Date.now() });
    }
    this.#attempt = 0;
    await Promise.resolve();
  }

  dispose(): void {
    this.#listeners.clear();
  }

  simulateFailure(errorCode: string, message: string): void {
    this.#setState({ kind: 'failed', changedAt: Date.now(), errorCode, message });
  }

  subscribe(listener: AccountSessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #setState(next: AccountConnectionState): void {
    this.#state = transitionConnectionState(this.#state, next);
    for (const listener of this.#listeners) listener(this.#state);
  }
}
