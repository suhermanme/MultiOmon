import { AccountManager } from '../application/accounts/account-manager';
import { InMemoryAccountSession } from '../application/accounts/account-session';
import type {
  AccountRepository,
  RepositoryBundle,
  TransactionRunner,
} from '../application/ports/repositories';
import {
  createAccountId,
  createChatId,
  createContactId,
  createMessageId,
  type Account,
} from '../domain';

const mockAccounts: readonly Account[] = [
  { id: createAccountId('mock-personal'), displayName: 'Personal', createdAt: 1 },
  { id: createAccountId('mock-work'), displayName: 'Work', createdAt: 2 },
  { id: createAccountId('mock-community'), displayName: 'Community', createdAt: 3 },
];

export function seedMockProjection(
  transactionRunner: TransactionRunner,
  repositories: RepositoryBundle,
): void {
  if (repositories.accounts.list().length > 0) return;

  transactionRunner.runInTransaction(() => {
    mockAccounts.forEach((account, index) => {
      const contactId = createContactId(`${account.id}-contact`);
      const chatId = createChatId(`${account.id}-chat`);
      const sentAt = 1_700_000_000_000 + index;

      repositories.accounts.save(account);
      repositories.contacts.save({
        id: contactId,
        accountId: account.id,
        remoteId: 'example-contact@s.whatsapp.net',
        displayName: 'Example contact',
      });
      repositories.chats.save({
        id: chatId,
        accountId: account.id,
        remoteId: 'example-contact@s.whatsapp.net',
        kind: 'direct',
        title: 'Example conversation',
        unreadCount: 0,
        lastActivityAt: sentAt,
      });
      repositories.messages.insert({
        id: createMessageId(`${account.id}-message`),
        accountId: account.id,
        chatId,
        remoteId: 'welcome-message',
        direction: 'incoming',
        sentAt,
        content: { kind: 'system', text: 'Local persistence is ready.' },
      });
    });
  });
}

export async function createMockAccountManager(
  accountRepository: AccountRepository,
): Promise<AccountManager> {
  const manager = new AccountManager();

  for (const account of accountRepository.list()) {
    manager.addAccount(account, new InMemoryAccountSession(account.id));
  }

  await manager.connectAll();
  return manager;
}
