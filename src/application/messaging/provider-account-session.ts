import type { ManagedAccountSession, AccountSessionListener } from '../accounts/account-session';
import type { MessagingSession, ProviderConnectionState } from '../ports/messaging-provider';
import {
  transitionConnectionState,
  type AccountConnectionState,
  type AccountId,
} from '../../domain';

function toAccountState(state: ProviderConnectionState): AccountConnectionState {
  switch (state.kind) {
    case 'idle':
    case 'needsPairing':
    case 'connecting':
    case 'connected':
    case 'disconnected':
    case 'failed':
      return state;
  }
}

export class ProviderAccountSession implements ManagedAccountSession {
  readonly accountId: AccountId;
  readonly #session: MessagingSession;
  readonly #listeners = new Set<AccountSessionListener>();
  readonly #unsubscribe: () => void;
  #state: AccountConnectionState;

  constructor(session: MessagingSession) {
    this.accountId = session.accountId;
    this.#session = session;
    this.#state = toAccountState(session.getConnectionState());
    this.#unsubscribe = session.subscribe((event) => {
      if (event.type !== 'connection.changed') return;
      this.#applyState(toAccountState(event.state));
    });
  }

  #applyState(next: AccountConnectionState): void {
    // Providers may re-announce their current state (retry ticks, re-pairing requests).
    // Same-kind updates refresh `changedAt` instead of being rejected as transitions.
    if (this.#state.kind !== next.kind) {
      this.#state = transitionConnectionState(this.#state, next);
    } else {
      this.#state = next;
    }
    for (const listener of this.#listeners) listener(this.#state);
  }

  getState(): AccountConnectionState {
    return this.#state;
  }

  connect(): Promise<void> {
    return this.#session.connect();
  }

  disconnect(reason?: string): Promise<void> {
    return this.#session.disconnect(reason);
  }

  startPairing(): Promise<void> {
    return this.#session.startPairing();
  }

  logout(): Promise<void> {
    return this.#session.logout();
  }

  subscribe(listener: AccountSessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#unsubscribe();
    this.#listeners.clear();
  }
}
