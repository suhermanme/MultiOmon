import { AccountManager } from '../application/accounts/account-manager';
import type { MessagingService } from '../application/messaging/messaging-service';
import type {
  AccountRepository,
  RepositoryBundle,
  TransactionRunner,
} from '../application/ports/repositories';
import { createAccountId, type Account } from '../domain';
import { MockMessagingProvider } from '../infrastructure/messaging/mock';
import { WhatsappMessagingProvider } from '../infrastructure/messaging/whatsapp';

const mockAccounts: readonly Account[] = [
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
    for (const account of mockAccounts) repositories.accounts.save(account);
  });
}

export async function createMockAccountManager(
  accountRepository: AccountRepository,
  messagingService: MessagingService,
): Promise<AccountManager> {
  const manager = new AccountManager();

  for (const account of accountRepository.list()) {
    manager.addAccount(account, messagingService.createAccountSession(account.id));
  }

  await manager.connectAll();
  return manager;
}

export function createMockMessagingProvider(): MockMessagingProvider {
  return new MockMessagingProvider((accountId) => {
    const accountIndex = mockAccounts.findIndex((account) => account.id === accountId);
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

export function createWhatsappMessagingProvider(authDir: string): WhatsappMessagingProvider {
  return new WhatsappMessagingProvider(authDir, () => {
    const phoneNumber = process.env.WA_PHONE_NUMBER;
    return phoneNumber !== undefined ? { phoneNumber } : {};
  });
}
