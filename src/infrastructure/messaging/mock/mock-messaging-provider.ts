import {
  ProviderError,
  type MessagingEvent,
  type MessagingEventListener,
  type MessagingProvider,
  type MessagingSession,
  type ProviderChat,
  type ProviderConnectionState,
  type ProviderMessage,
  type SendTextRequest,
} from '../../../application/ports/messaging-provider';
import type { AccountId } from '../../../domain';

export interface MockAccountHistory {
  readonly chats?: readonly ProviderChat[];
  readonly messages?: readonly ProviderMessage[];
}

export interface MockSessionOptions {
  readonly paired?: boolean;
  readonly history?: MockAccountHistory;
  readonly failConnectionWith?: { readonly code: string; readonly message: string };
  readonly now?: () => number;
}

export class MockMessagingSession implements MessagingSession {
  readonly accountId: AccountId;
  readonly #listeners = new Set<MessagingEventListener>();
  readonly #history: MockAccountHistory;
  readonly #failConnectionWith: MockSessionOptions['failConnectionWith'];
  readonly #now: () => number;
  #state: ProviderConnectionState;
  #paired: boolean;
  #attempt = 0;
  #messageSequence = 0;
  #pairingAttempt = 0;
  #disposed = false;

  constructor(accountId: AccountId, options: MockSessionOptions = {}) {
    this.accountId = accountId;
    this.#paired = options.paired ?? true;
    this.#history = options.history ?? {};
    this.#failConnectionWith = options.failConnectionWith;
    this.#now = options.now ?? Date.now;
    this.#state = { kind: 'idle', changedAt: this.#now() };
  }

  getConnectionState(): ProviderConnectionState {
    return this.#state;
  }

  async startPairing(): Promise<void> {
    this.#assertNotDisposed();
    this.#paired = false;
    if (this.#state.kind === 'connected' || this.#state.kind === 'connecting') {
      await this.disconnect('pairing-restarted');
    }
    if (this.#state.kind !== 'needsPairing') {
      this.#setState({ kind: 'needsPairing', changedAt: this.#now() });
    }
    this.#pairingAttempt += 1;
    this.#emit({
      type: 'pairing.qr',
      accountId: this.accountId,
      payload: `mock-qr:${this.accountId}:${this.#pairingAttempt}`,
    });
    this.#emit({
      type: 'pairing.code',
      accountId: this.accountId,
      code: `mock-qr:${this.accountId}`,
      expiresAt: this.#now() + 60_000,
    });
    await Promise.resolve();
  }

  async connect(): Promise<void> {
    this.#assertNotDisposed();
    if (this.#state.kind === 'connected') return;
    if (!this.#paired) {
      await this.startPairing();
      throw new ProviderError(this.accountId, 'pairing-required', 'Account requires pairing');
    }

    this.#attempt += 1;
    this.#setState({ kind: 'connecting', changedAt: this.#now(), attempt: this.#attempt });
    await Promise.resolve();
    if (this.#failConnectionWith) {
      const failure = this.#failConnectionWith;
      this.#setState({
        kind: 'failed',
        changedAt: this.#now(),
        errorCode: failure.code,
        message: failure.message,
      });
      throw new ProviderError(this.accountId, failure.code, failure.message);
    }

    const connectedAt = this.#now();
    this.#setState({ kind: 'connected', changedAt: connectedAt, connectedAt });
    for (const chat of this.#history.chats ?? []) this.#emit({ type: 'chat.upserted', chat });
    for (const message of this.#history.messages ?? []) {
      this.#emit({ type: 'message.upserted', message });
    }
  }

  async disconnect(reason?: string): Promise<void> {
    if (this.#disposed) return;
    if (this.#state.kind === 'disconnected') return;
    this.#setState({ kind: 'disconnected', changedAt: this.#now(), reason });
    await Promise.resolve();
  }

  async logout(): Promise<void> {
    if (this.#disposed) return;
    this.#paired = false;
    if (this.#state.kind !== 'disconnected') await this.disconnect('logged-out');
    this.#setState({ kind: 'needsPairing', changedAt: this.#now() });
  }

  sendText(request: SendTextRequest): Promise<ProviderMessage> {
    if (this.#disposed) {
      return Promise.reject(
        new ProviderError(this.accountId, 'session-disposed', 'Session has been disposed'),
      );
    }
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

    this.#messageSequence += 1;
    const message: ProviderMessage = {
      accountId: this.accountId,
      remoteId: `mock-outgoing-${this.#messageSequence}`,
      chatRemoteId: request.chatRemoteId,
      direction: 'outgoing',
      sentAt: this.#now(),
      content: { kind: 'text', text: request.text },
      ...(request.replyToRemoteMessageId === undefined
        ? {}
        : { replyToRemoteMessageId: request.replyToRemoteMessageId }),
    };
    this.#emit({ type: 'message.upserted', message });
    return Promise.resolve(message);
  }

  subscribe(listener: MessagingEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new ProviderError(this.accountId, 'session-disposed', 'Session has been disposed');
    }
  }

  async simulatePairingSuccess(): Promise<void> {
    this.#paired = true;
    await this.connect();
  }

  async simulateReconnect(): Promise<void> {
    await this.disconnect('connection-lost');
    await this.connect();
  }

  simulateIncomingMessage(message: Omit<ProviderMessage, 'accountId' | 'direction'>): void {
    if (this.#state.kind !== 'connected') {
      throw new ProviderError(this.accountId, 'not-connected', 'Cannot receive while disconnected');
    }
    this.#emit({
      type: 'message.upserted',
      message: { ...message, accountId: this.accountId, direction: 'incoming' },
    });
  }

  simulateChat(chat: Omit<ProviderChat, 'accountId'>): void {
    this.#emit({ type: 'chat.upserted', chat: { ...chat, accountId: this.accountId } });
  }

  #setState(state: ProviderConnectionState): void {
    this.#state = state;
    this.#emit({ type: 'connection.changed', state });
  }

  #emit(event: MessagingEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

export type MockSessionOptionsFactory = (accountId: AccountId) => MockSessionOptions;

export class MockMessagingProvider implements MessagingProvider {
  readonly #sessions = new Map<AccountId, MockMessagingSession>();
  readonly #optionsFactory: MockSessionOptionsFactory;

  constructor(optionsFactory: MockSessionOptionsFactory = () => ({})) {
    this.#optionsFactory = optionsFactory;
  }

  createSession(accountId: AccountId): MockMessagingSession {
    if (this.#sessions.has(accountId)) {
      throw new ProviderError(accountId, 'duplicate-session', 'Session already exists');
    }
    const session = new MockMessagingSession(accountId, this.#optionsFactory(accountId));
    this.#sessions.set(accountId, session);
    return session;
  }

  getSession(accountId: AccountId): MockMessagingSession {
    const session = this.#sessions.get(accountId);
    if (!session) throw new ProviderError(accountId, 'missing-session', 'Session does not exist');
    return session;
  }
}
