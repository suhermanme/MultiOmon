import { AccountManager } from '../application/accounts/account-manager';
import { InMemoryAccountSession } from '../application/accounts/account-session';
import { createAccountId, type Account } from '../domain';

const mockAccounts: readonly Account[] = [
  { id: createAccountId('mock-personal'), displayName: 'Personal', createdAt: 1 },
  { id: createAccountId('mock-work'), displayName: 'Work', createdAt: 2 },
  { id: createAccountId('mock-community'), displayName: 'Community', createdAt: 3 },
];

export async function createMockAccountManager(): Promise<AccountManager> {
  const manager = new AccountManager();

  for (const account of mockAccounts) {
    manager.addAccount(account, new InMemoryAccountSession(account.id));
  }

  await manager.connectAll();
  return manager;
}
