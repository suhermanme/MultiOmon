import {
  ProviderError,
  type MessagingProvider,
} from '../../../application/ports/messaging-provider';
import type { AccountId } from '../../../domain';
import {
  WhatsappMessagingSession,
  type WhatsappSessionOptions,
} from './whatsapp-messaging-session';

export type WhatsappSessionOptionsFactory = (accountId: AccountId) => WhatsappSessionOptions;

export class WhatsappMessagingProvider implements MessagingProvider {
  readonly #sessions = new Map<AccountId, WhatsappMessagingSession>();
  readonly #authDir: string;
  readonly #optionsFactory: WhatsappSessionOptionsFactory;

  constructor(authDir: string, optionsFactory: WhatsappSessionOptionsFactory = () => ({})) {
    this.#authDir = authDir;
    this.#optionsFactory = optionsFactory;
  }

  createSession(accountId: AccountId): WhatsappMessagingSession {
    if (this.#sessions.has(accountId)) {
      throw new ProviderError(accountId, 'duplicate-session', 'Session already exists');
    }
    const session = new WhatsappMessagingSession(
      accountId,
      this.#authDir,
      this.#optionsFactory(accountId),
    );
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
