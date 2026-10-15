import { useEffect, useState } from 'react';
import type {
  AccountConnectionStateDto,
  AccountSummaryDto,
  RuntimeInfo,
} from '../../shared/contracts/desktop-api';
import { useAccountStore } from './account-store';

type BridgeStatus =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly runtime: RuntimeInfo }
  | { readonly kind: 'failed' };

const statusLabels: Readonly<Record<AccountConnectionStateDto, string>> = {
  idle: 'Idle',
  needsPairing: 'Needs pairing',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Disconnected',
  failed: 'Error',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

interface AccountButtonProps {
  readonly account: AccountSummaryDto;
  readonly active: boolean;
  readonly onSelect: (accountId: string) => void;
}

function AccountButton({ account, active, onSelect }: AccountButtonProps): React.JSX.Element {
  const status = statusLabels[account.connectionState];

  return (
    <button
      className={`account-button${active ? ' account-button-active' : ''}`}
      type="button"
      aria-label={`Switch to ${account.displayName} account, ${status}`}
      aria-pressed={active}
      title={`${account.displayName} · ${status}`}
      onClick={() => onSelect(account.id)}
    >
      <span className="account-avatar" aria-hidden="true">
        {initials(account.displayName)}
      </span>
      <span className={`account-status status-${account.connectionState}`} aria-hidden="true" />
    </button>
  );
}

export function App(): React.JSX.Element {
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ kind: 'checking' });
  const { snapshot, loading, error, applySnapshot, setLoadError, selectAccount } =
    useAccountStore();
  const activeAccount =
    snapshot.accounts.find((account) => account.id === snapshot.activeAccountId) ?? null;

  useEffect(() => {
    let active = true;
    const unsubscribe = window.multiomon.accounts.subscribe((nextSnapshot) => {
      if (active) applySnapshot(nextSnapshot);
    });

    Promise.all([
      window.multiomon.ping(),
      window.multiomon.getRuntimeInfo(),
      window.multiomon.accounts.getSnapshot(),
    ])
      .then(([response, runtime, accountSnapshot]) => {
        if (!active) return;
        if (response === 'pong') setBridgeStatus({ kind: 'ready', runtime });
        applySnapshot(accountSnapshot);
      })
      .catch(() => {
        if (!active) return;
        setBridgeStatus({ kind: 'failed' });
        setLoadError('The desktop account service is unavailable.');
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySnapshot, setLoadError]);

  const handleSelect = (accountId: string): void => {
    void selectAccount(accountId);
  };

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="wordmark">
          <span className="wordmark-icon" aria-hidden="true">
            M
          </span>
          <span>MultiOmon</span>
        </div>
        <div className={`bridge-pill bridge-${bridgeStatus.kind}`} role="status">
          <span aria-hidden="true" />
          {bridgeStatus.kind === 'ready'
            ? 'Desktop ready'
            : bridgeStatus.kind === 'failed'
              ? 'Desktop unavailable'
              : 'Starting…'}
        </div>
      </header>

      <div className="workspace">
        <aside className="account-rail" aria-label="Accounts">
          <div className="account-list">
            {snapshot.accounts.map((account) => (
              <AccountButton
                key={account.id}
                account={account}
                active={account.id === snapshot.activeAccountId}
                onSelect={handleSelect}
              />
            ))}
          </div>
          <button
            className="add-account"
            type="button"
            aria-label="Add account (available in a later milestone)"
            title="Account pairing arrives in a later milestone"
            disabled
          >
            +
          </button>
        </aside>

        <section className="conversation-list" aria-label="Conversations">
          <div className="panel-header">
            <div>
              <span className="section-label">Account</span>
              <h1>{activeAccount?.displayName ?? (loading ? 'Loading…' : 'No account')}</h1>
            </div>
            {activeAccount && (
              <span className={`connection-badge badge-${activeAccount.connectionState}`}>
                {statusLabels[activeAccount.connectionState]}
              </span>
            )}
          </div>

          {error ? (
            <div className="account-error" role="alert">
              {error}
            </div>
          ) : (
            <div className="empty-list">
              <div className="empty-list-icon" aria-hidden="true">
                ≡
              </div>
              <strong>Conversation list ready</strong>
              <p>Chats arrive after the provider and persistence foundations are in place.</p>
            </div>
          )}
        </section>

        <section className="conversation-view" aria-label="Current conversation">
          <div className="empty-conversation">
            <div className="orbit-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span className="section-label">Multi-account foundation</span>
            <h2>
              {activeAccount ? `${activeAccount.displayName} is active` : 'Select an account'}
            </h2>
            <p>All mock sessions remain connected independently while you move between accounts.</p>
            {bridgeStatus.kind === 'ready' && (
              <span className="runtime-label">
                {bridgeStatus.runtime.platform} · Electron {bridgeStatus.runtime.versions.electron}
              </span>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
