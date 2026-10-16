import { randomUUID } from 'node:crypto';
import type { Account, AccountId } from '../../domain';
import { createAccountId } from '../../domain';
import type { AccountRepository } from '../ports/repositories';
import type { MessagingService } from '../messaging/messaging-service';
import type { AccountManager } from './account-manager';

export interface CreateAccountCommand {
  readonly displayName: string;
  readonly phoneNumber?: string;
}

export type AccountProvisioningErrorCode =
  'invalid-display-name' | 'invalid-phone-number' | 'missing-account';

export class AccountProvisioningError extends Error {
  readonly code: AccountProvisioningErrorCode;

  constructor(code: AccountProvisioningErrorCode, message: string) {
    super(message);
    this.name = 'AccountProvisioningError';
    this.code = code;
  }
}

export interface AccountProvisioningOptions {
  readonly accounts: AccountRepository;
  readonly accountManager: AccountManager;
  readonly messaging: MessagingService;
  readonly mintAccountId?: () => AccountId;
  readonly now?: () => number;
}

const MAX_DISPLAY_NAME_LENGTH = 64;
const PHONE_NUMBER_PATTERN = /^\+?[0-9]{5,15}$/;

function normalizePhoneNumber(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/[\s()-]/g, '');
  if (normalized.length === 0) return undefined;
  if (!PHONE_NUMBER_PATTERN.test(normalized)) {
    throw new AccountProvisioningError(
      'invalid-phone-number',
      'Phone number must be 5-15 digits, optionally starting with +',
    );
  }
  return normalized;
}

export class AccountProvisioningService {
  readonly #accounts: AccountRepository;
  readonly #accountManager: AccountManager;
  readonly #messaging: MessagingService;
  readonly #mintAccountId: () => AccountId;
  readonly #now: () => number;

  constructor(options: AccountProvisioningOptions) {
    this.#accounts = options.accounts;
    this.#accountManager = options.accountManager;
    this.#messaging = options.messaging;
    this.#mintAccountId = options.mintAccountId ?? (() => createAccountId(randomUUID()));
    this.#now = options.now ?? Date.now;
  }

  createAccount(command: CreateAccountCommand): Account {
    const displayName = command.displayName.trim();
    if (displayName.length === 0) {
      throw new AccountProvisioningError('invalid-display-name', 'Account name is required');
    }
    if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new AccountProvisioningError(
        'invalid-display-name',
        `Account name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`,
      );
    }
    const phoneNumber = normalizePhoneNumber(command.phoneNumber);

    const account: Account = {
      id: this.#mintAccountId(),
      displayName,
      createdAt: this.#now(),
      ...(phoneNumber === undefined ? {} : { phoneNumber }),
    };

    this.#accounts.save(account);
    try {
      this.#accountManager.addAccount(account, this.#messaging.createAccountSession(account.id));
    } catch (error) {
      // The account never became usable: drop the row so the projection and the
      // live session set stay in sync.
      this.#accounts.delete(account.id);
      throw error;
    }
    return account;
  }

  restoreAccounts(): readonly Account[] {
    const restored: Account[] = [];
    for (const account of this.#accounts.list()) {
      if (this.#accountManager.hasAccount(account.id)) continue;
      this.#accountManager.addAccount(account, this.#messaging.createAccountSession(account.id));
      restored.push(account);
    }
    return restored;
  }

  async removeAccount(accountId: AccountId): Promise<void> {
    if (this.#accountManager.hasAccount(accountId)) {
      await this.#accountManager.removeAccount(accountId);
    }
    if (this.#messaging.hasAccountSession(accountId)) {
      this.#messaging.removeAccountSession(accountId);
    }
    this.#accounts.delete(accountId);
  }

  async logoutAccount(accountId: AccountId): Promise<void> {
    this.#requireManaged(accountId);
    await this.#accountManager.logoutAccount(accountId);
  }

  async startPairing(accountId: AccountId): Promise<void> {
    this.#requireManaged(accountId);
    await this.#accountManager.startPairing(accountId);
  }

  async connectAccount(accountId: AccountId): Promise<void> {
    this.#requireManaged(accountId);
    await this.#accountManager.connect(accountId);
  }

  #requireManaged(accountId: AccountId): void {
    if (!this.#accountManager.hasAccount(accountId)) {
      throw new AccountProvisioningError(
        'missing-account',
        `Account ${accountId} is not registered`,
      );
    }
  }
}
