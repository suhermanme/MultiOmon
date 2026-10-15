import { describe, expect, it } from 'vitest';
import { AccountManager } from '../../src/application/accounts/account-manager';
import { InMemoryAccountSession } from '../../src/application/accounts/account-session';
import { createAccountId, type Account } from '../../src/domain';

function account(value: string): Account {
  return { id: createAccountId(value), displayName: value, createdAt: 1 };
}

describe('AccountManager', () => {
  it('connects three independent accounts and switches without disconnecting', async () => {
    const manager = new AccountManager();
    const accounts = [account('personal'), account('work'), account('community')];

    for (const item of accounts) {
      manager.addAccount(item, new InMemoryAccountSession(item.id));
    }

    const results = await manager.connectAll();
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(
      manager.getSnapshot().accounts.map(({ connectionState }) => connectionState.kind),
    ).toEqual(['connected', 'connected', 'connected']);

    manager.selectAccount(accounts[1]!.id);
    const snapshot = manager.getSnapshot();
    expect(snapshot.activeAccountId).toBe(accounts[1]!.id);
    expect(
      snapshot.accounts.every(({ connectionState }) => connectionState.kind === 'connected'),
    ).toBe(true);
  });

  it('isolates a failed account from healthy sessions', async () => {
    const manager = new AccountManager();
    const healthy = account('healthy');
    const failing = account('failing');

    manager.addAccount(healthy, new InMemoryAccountSession(healthy.id));
    manager.addAccount(
      failing,
      new InMemoryAccountSession(failing.id, {
        failConnectionWith: { code: 'mock-failure', message: 'Expected failure' },
      }),
    );

    const results = await manager.connectAll();
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(
      manager.getSnapshot().accounts.map(({ connectionState }) => connectionState.kind),
    ).toEqual(['connected', 'failed']);
  });

  it('keeps account-scoped session changes independent', async () => {
    const manager = new AccountManager();
    const first = account('first');
    const second = account('second');
    manager.addAccount(first, new InMemoryAccountSession(first.id));
    manager.addAccount(second, new InMemoryAccountSession(second.id));
    await manager.connectAll();

    await manager.disconnect(first.id, 'test');

    expect(
      manager.getSnapshot().accounts.map(({ connectionState }) => connectionState.kind),
    ).toEqual(['disconnected', 'connected']);
  });
});
