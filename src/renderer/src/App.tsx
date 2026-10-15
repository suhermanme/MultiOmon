import { useEffect, useState } from 'react';
import type {
  AccountConnectionStateDto,
  AccountSummaryDto,
  RuntimeInfo,
} from '../../shared/contracts/desktop-api';
import { useAccountStore } from './account-store';
import { useMessagingStore } from './messaging-store';

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
  const {
    chats,
    selectedChatId,
    messages,
    loading: messagingLoading,
    error: messagingError,
    loadAccount,
    selectChat,
  } = useMessagingStore();
  const activeAccount =
    snapshot.accounts.find((account) => account.id === snapshot.activeAccountId) ?? null;

  useEffect(() => {
    let active = true;
    const unsubscribe = window.multiomon.accounts.subscribe((nextSnapshot) => {
      if (active) applySnapshot(nextSnapshot);
    });
    const unsubscribeMessaging = window.multiomon.messaging.subscribe((change) => {
      if (active) void useMessagingStore.getState().refresh(change);
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
      unsubscribeMessaging();
    };
  }, [applySnapshot, setLoadError]);

  useEffect(() => {
    void loadAccount(snapshot.activeAccountId);
  }, [loadAccount, snapshot.activeAccountId]);

  const handleSelect = (accountId: string): void => {
    void selectAccount(accountId);
  };

  const selectedChat = chats.find((chat) => chat.id === selectedChatId) ?? null;

  const messageText = (content: (typeof messages)[number]['content']): string => {
    switch (content.kind) {
      case 'text':
      case 'system':
        return content.text;
      case 'media':
        return content.caption ?? 'Media attachment';
    }
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

          {(error ?? messagingError) ? (
            <div className="account-error" role="alert">
              {error ?? messagingError}
            </div>
          ) : chats.length > 0 ? (
            <div className="chat-list" aria-label="Local conversations">
              {chats.map((chat) => (
                <button
                  key={chat.id}
                  className={`chat-row${chat.id === selectedChatId ? ' chat-row-active' : ''}`}
                  type="button"
                  aria-pressed={chat.id === selectedChatId}
                  onClick={() => void selectChat(chat.id)}
                >
                  <span className="chat-avatar" aria-hidden="true">
                    {initials(chat.title)}
                  </span>
                  <span className="chat-copy">
                    <strong>{chat.title}</strong>
                    <span>{chat.kind === 'group' ? 'Group' : 'Direct conversation'}</span>
                  </span>
                  {chat.unreadCount > 0 && <span className="unread-count">{chat.unreadCount}</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-list">
              <div className="empty-list-icon" aria-hidden="true">
                ≡
              </div>
              <strong>
                {messagingLoading ? 'Loading conversations…' : 'No conversations yet'}
              </strong>
              <p>New conversations will appear here after they are stored locally.</p>
            </div>
          )}
        </section>

        <section className="conversation-view" aria-label="Current conversation">
          {selectedChat ? (
            <div className="message-panel">
              <header className="message-header">
                <span className="section-label">Local projection</span>
                <h2>{selectedChat.title}</h2>
              </header>
              <div className="message-list" aria-label={`Messages in ${selectedChat.title}`}>
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`message-bubble message-${message.direction}`}
                  >
                    {message.content.kind === 'system' && (
                      <span className="message-kind">System</span>
                    )}
                    <p>{messageText(message.content)}</p>
                  </article>
                ))}
              </div>
              <div className="projection-note">
                Read-only local history · sending arrives in M08
              </div>
            </div>
          ) : (
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
              <p>
                Provider events are normalized, persisted, and delivered through the secure bridge.
              </p>
              {bridgeStatus.kind === 'ready' && (
                <span className="runtime-label">
                  {bridgeStatus.runtime.platform} · Electron{' '}
                  {bridgeStatus.runtime.versions.electron}
                </span>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
