import { AccountManager } from '../application/accounts/account-manager';
import { AccountProvisioningService } from '../application/accounts/account-provisioning';
import { MessagingService } from '../application/messaging/messaging-service';
import type { MessagingProvider } from '../application/ports/messaging-provider';
import type {
  AccountRepository,
  RepositoryBundle,
  TransactionRunner,
} from '../application/ports/repositories';
import { createAccountId, type Account, type AccountId } from '../domain';
import { MockMessagingProvider } from '../infrastructure/messaging/mock';
import { WhatsappMessagingProvider } from '../infrastructure/messaging/whatsapp';

const seedAccounts: readonly Account[] = [
  { id: createAccountId('mock-personal'), displayName: 'Personal', createdAt: 1 },
  { id: createAccountId('mock-work'), displayName: 'Work', createdAt: 2 },
  { id: createAccountId('mock-community'), displayName: 'Community', createdAt: 3 },
];

export function seedMockAccounts(
  transactionRunner: TransactionRunner,
  repositories: RepositoryBundle,
): void {
  if (repositories.accounts.list().length > 0) return;

  transactionRunner.runInTransaction(() => {
    for (const account of seedAccounts) repositories.accounts.save(account);
  });
}

export function createMockMessagingProvider(): MockMessagingProvider {
  return new MockMessagingProvider((accountId) => {
    const accountIndex = seedAccounts.findIndex((account) => account.id === accountId);
    const sentAt = 1_710_000_000_000 + Math.max(accountIndex, 0);
    return {
      paired: true,
      history: {
        chats: [
          {
            accountId,
            remoteId: 'example-contact@s.whatsapp.net',
            kind: 'direct',
            title: 'Example conversation',
            unreadCount: 0,
            lastActivityAt: sentAt,
          },
        ],
        messages: [
          {
            accountId,
            remoteId: 'mock-provider-welcome-v1',
            chatRemoteId: 'example-contact@s.whatsapp.net',
            direction: 'incoming',
            sentAt,
            content: { kind: 'system', text: 'Mock provider projection is connected.' },
          },
        ],
      },
    };
  });
}

export function createWhatsappMessagingProvider(
  authDir: string,
  accounts: AccountRepository,
): WhatsappMessagingProvider {
  return new WhatsappMessagingProvider(authDir, {
    phoneLookup: (accountId: AccountId) => accounts.getById(accountId)?.phoneNumber,
  });
}

export interface ApplicationOptions {
  readonly transactionRunner: TransactionRunner;
  readonly repositories: RepositoryBundle;
  readonly messagingProvider: MessagingProvider;
  readonly useWhatsapp: boolean;
}

export interface Application {
  readonly messagingService: MessagingService;
  readonly accountManager: AccountManager;
  readonly provisioning: AccountProvisioningService;
}

export async function bootstrapApplication(options: ApplicationOptions): Promise<Application> {
  const messagingService = new MessagingService(
    options.messagingProvider,
    options.transactionRunner,
    options.repositories,
  );
  const accountManager = new AccountManager();
  const provisioning = new AccountProvisioningService({
    accounts: options.repositories.accounts,
    accountManager,
    messaging: messagingService,
  });

  if (!options.useWhatsapp) seedMockAccounts(options.transactionRunner, options.repositories);
  provisioning.restoreAccounts();
  // Live transports must not dial every stored account at startup; pairing is an
  // explicit user action in WhatsApp mode.
  if (!options.useWhatsapp) await accountManager.connectAll();

  return { messagingService, accountManager, provisioning };
}
