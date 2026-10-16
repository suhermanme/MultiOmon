import {
  ProviderError,
  type MessagingProvider,
} from '../../../application/ports/messaging-provider';
import type { AccountId } from '../../../domain';
import {
  WhatsappMessagingSession,
  type WhatsappReconnectOptions,
  type WhatsappSessionOptions,
} from './whatsapp-messaging-session';

export interface WhatsappProviderOptions {
  readonly reconnect?: WhatsappReconnectOptions;
}

export class WhatsappMessagingProvider implements MessagingProvider {
  readonly #sessions = new Map<AccountId, WhatsappMessagingSession>();
  readonly #authDir: string;
  readonly #reconnect?: WhatsappReconnectOptions;

  constructor(authDir: string, options: WhatsappProviderOptions = {}) {
    this.#authDir = authDir;
    this.#reconnect = options.reconnect;
  }

  createSession(accountId: AccountId): WhatsappMessagingSession {
    if (this.#sessions.has(accountId)) {
      throw new ProviderError(accountId, 'duplicate-session', 'Session already exists');
    }
    const sessionOptions: WhatsappSessionOptions = {
      ...(this.#reconnect === undefined ? {} : { reconnect: this.#reconnect }),
    };
    const session = new WhatsappMessagingSession(accountId, this.#authDir, sessionOptions);
    this.#sessions.set(accountId, session);
    return session;
  }

  getSession(accountId: AccountId): WhatsappMessagingSession {
    const session = this.#sessions.get(accountId);
    if (!session) {
      throw new ProviderError(accountId, 'missing-session', 'Session does not exist');
    }
    return session;
  }
}
