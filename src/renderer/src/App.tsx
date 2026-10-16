import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type {
  AccountConnectionStateDto,
  AccountSummaryDto,
  CreateAccountRequestDto,
  PairingUpdateDto,
  RuntimeInfo,
} from '../../shared/contracts/desktop-api';
import { useAccountStore } from './account-store';
import { useMessagingStore } from './messaging-store';
import { subscribePairing, usePairingStore } from './pairing-store';

type BridgeStatus =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly runtime: RuntimeInfo }
  | { readonly kind: 'failed' };

const statusLabels: Readonly<Record<AccountConnectionStateDto['kind'], string>> = {
  idle: 'Idle',
  needsPairing: 'Needs pairing',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Disconnected',
  failed: 'Error',
};

const emptyChatStates: Readonly<
  Record<AccountConnectionStateDto['kind'], { readonly title: string; readonly body: string }>
> = {
  idle: {
    title: 'Not connected yet',
    body: 'Pair this account or press Connect to sync its conversations.',
  },
  needsPairing: {
    title: 'Pairing required',
    body: 'Scan the pairing code with WhatsApp to sync this account.',
  },
  connecting: {
    title: 'Syncing conversations…',
    body: 'Message history is being downloaded and stored locally.',
  },
  connected: {
    title: 'No conversations yet',
    body: 'New conversations will appear here after they are stored locally.',
  },
  disconnected: {
    title: 'Connection lost',
    body: 'Press Connect to resume syncing this account.',
  },
  failed: {
    title: 'Sync failed',
    body: 'Review the account error, then pair or connect again.',
  },
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
  const status =
    account.connectionState.kind === 'connecting'
      ? `Connecting · attempt ${account.connectionState.attempt}`
      : statusLabels[account.connectionState.kind];

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
      <span className="account-copy">
        <strong>{account.displayName}</strong>
        {account.phoneNumber ? <span>{account.phoneNumber}</span> : null}
      </span>
      <span
        className={`account-status status-${account.connectionState.kind}`}
        aria-hidden="true"
      />
    </button>
  );
}

interface AddAccountFormProps {
  readonly busy: boolean;
  readonly onCreate: (request: CreateAccountRequestDto) => Promise<boolean>;
}

function AddAccountForm({ busy, onCreate }: AddAccountFormProps): React.JSX.Element {
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const name = displayName.trim();
  const phone = phoneNumber.trim();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (name === '' || submitting) return;
    setSubmitting(true);
    const created = await onCreate(
      phone === '' ? { displayName: name } : { displayName: name, phoneNumber: phone },
    );
    setSubmitting(false);
    if (!created) return;
    setDisplayName('');
    setPhoneNumber('');
  };

  return (
    <form className="add-account-form" onSubmit={(event) => void handleSubmit(event)}>
      <label htmlFor="new-account-name">New account</label>
      <input
        id="new-account-name"
        className="text-input"
        value={displayName}
        placeholder="Personal"
        onChange={(event) => setDisplayName(event.target.value)}
      />
      <label htmlFor="new-account-phone">Phone (optional)</label>
      <input
        id="new-account-phone"
        className="text-input"
        value={phoneNumber}
        placeholder="+15551234567"
        inputMode="tel"
        onChange={(event) => setPhoneNumber(event.target.value)}
      />
      <button
        className="add-account-submit"
        type="submit"
        disabled={name === '' || submitting || busy}
      >
        {submitting ? 'Adding…' : 'Add account'}
      </button>
    </form>
  );
}

interface AccountActionsProps {
  readonly account: AccountSummaryDto;
  readonly busy: boolean;
  readonly onPair: (accountId: string) => void;
  readonly onConnect: (accountId: string) => void;
  readonly onLogout: (accountId: string) => void;
  readonly onRemove: (accountId: string) => void;
}

function AccountActions({
  account,
  busy,
  onPair,
  onConnect,
  onLogout,
  onRemove,
}: AccountActionsProps): React.JSX.Element {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const { connectionState } = account;
  const connected = connectionState.kind === 'connected';
  const connecting = connectionState.kind === 'connecting';
  const hasSession = connected || connecting || connectionState.kind === 'needsPairing';

  return (
    <div className="account-actions" aria-label={`Account actions for ${account.displayName}`}>
      <button
        className="action-button"
        type="button"
        disabled={busy || connecting || connected}
        onClick={() => void onPair(account.id)}
      >
        Pair
      </button>
      {connected ? null : (
        <button
          className="action-button"
          type="button"
          disabled={busy || connecting}
          onClick={() => void onConnect(account.id)}
        >
          Connect
        </button>
      )}
      <button
        className="action-button"
        type="button"
        disabled={busy || !hasSession}
        onClick={() => void onLogout(account.id)}
      >
        Log out
      </button>
      {confirmingRemove ? (
        <span className="remove-confirm">
          <span className="remove-confirm-label">Remove {account.displayName}?</span>
          <button
            className="action-button action-danger"
            type="button"
            onClick={() => {
              setConfirmingRemove(false);
              onRemove(account.id);
            }}
          >
            Confirm remove
          </button>
          <button
            className="action-button action-ghost"
            type="button"
            onClick={() => setConfirmingRemove(false)}
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          className="action-button action-danger"
          type="button"
          disabled={busy}
          onClick={() => setConfirmingRemove(true)}
        >
          Remove
        </button>
      )}
    </div>
  );
}

function PairingQr({ payload }: { readonly payload: string }): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toString(payload, { type: 'svg' })
      .then((svg) => {
        if (active) setDataUrl(`data:image/svg+xml;base64,${btoa(svg)}`);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [payload]);

  if (dataUrl === null) {
    return (
      <div className="pairing-qr pairing-qr-pending" role="status">
        Preparing QR code…
      </div>
    );
  }

  return (
    <img className="pairing-qr" src={dataUrl} alt="Pairing QR code" width={220} height={220} />
  );
}

interface PairingPanelProps {
  readonly account: AccountSummaryDto;
  readonly update: PairingUpdateDto;
}

function PairingPanel({ account, update }: PairingPanelProps): React.JSX.Element | null {
  if (update.kind === 'cleared' || account.connectionState.kind === 'connected') return null;

  return (
    <section className="pairing-panel" aria-label={`Pairing for ${account.displayName}`}>
      <span className="pairing-title">Pair {account.displayName}</span>
      {update.kind === 'qr' ? (
        <div className="pairing-qr-block">
          <PairingQr key={update.payload} payload={update.payload} />
          <p>Scan this code with WhatsApp on the phone that owns this account.</p>
        </div>
      ) : (
        <div className="pairing-code-block">
          <strong className="pairing-code">{update.code}</strong>
          <time className="pairing-expiry" dateTime={new Date(update.expiresAt).toISOString()}>
            Expires {new Date(update.expiresAt).toLocaleString()}
          </time>
        </div>
      )}
    </section>
  );
}

export function App(): React.JSX.Element {
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ kind: 'checking' });
  const {
    snapshot,
    loading,
    error,
    pendingAction,
    applySnapshot,
    setLoadError,
    selectAccount,
    createAccount,
    removeAccount,
    logoutAccount,
    pairAccount,
    connectAccount,
  } = useAccountStore();
  const {
    chats,
    chatsNextCursor,
    selectedChatId,
    messages,
    messagesNextCursor,
    loading: messagingLoading,
    error: messagingError,
    loadAccount,
    selectChat,
    loadMoreChats,
    loadOlderMessages,
  } = useMessagingStore();
  const activeAccount =
    snapshot.accounts.find((account) => account.id === snapshot.activeAccountId) ?? null;
  const pairingUpdate = usePairingStore((state) =>
    activeAccount ? state.updates[activeAccount.id] : undefined,
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = window.multiomon.accounts.subscribe((nextSnapshot) => {
      if (active) applySnapshot(nextSnapshot);
    });
    const unsubscribeMessaging = window.multiomon.messaging.subscribe((changes) => {
      if (active) void useMessagingStore.getState().refresh(changes);
    });
    const unsubscribePairing = subscribePairing();

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
      unsubscribePairing();
    };
  }, [applySnapshot, setLoadError]);

  useEffect(() => {
    void loadAccount(snapshot.activeAccountId);
  }, [loadAccount, snapshot.activeAccountId]);

  const handleSelect = (accountId: string): void => {
    void selectAccount(accountId);
  };

  const [chatSearch, setChatSearch] = useState('');
  const chatQuery = chatSearch.trim().toLowerCase();
  const visibleChats =
    chatQuery.length === 0
      ? chats
      : chats.filter((chat) => chat.title.toLowerCase().includes(chatQuery));

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
          <AddAccountForm busy={pendingAction !== null} onCreate={createAccount} />
        </aside>

        <section className="conversation-list" aria-label="Conversations">
          <div className="panel-header">
            <div>
              <span className="section-label">Account</span>
              <h1>{activeAccount?.displayName ?? (loading ? 'Loading…' : 'No account')}</h1>
            </div>
            {activeAccount && (
              <span className={`connection-badge badge-${activeAccount.connectionState.kind}`}>
                {activeAccount.connectionState.kind === 'connecting'
                  ? `Connecting · attempt ${activeAccount.connectionState.attempt}`
                  : statusLabels[activeAccount.connectionState.kind]}
              </span>
            )}
          </div>
          {activeAccount && (
            <AccountActions
              key={activeAccount.id}
              account={activeAccount}
              busy={pendingAction !== null}
              onPair={(accountId) => void pairAccount(accountId)}
              onConnect={(accountId) => void connectAccount(accountId)}
              onLogout={(accountId) => void logoutAccount(accountId)}
              onRemove={(accountId) => void removeAccount(accountId)}
            />
          )}

          {activeAccount && pairingUpdate ? (
            <PairingPanel account={activeAccount} update={pairingUpdate} />
          ) : null}

          {(error ?? messagingError) ? (
            <div className="account-error" role="alert">
              {error ?? messagingError}
            </div>
          ) : (
            <>
              {chats.length > 0 && (
                <input
                  className="chat-search"
                  type="search"
                  placeholder="Search conversations"
                  aria-label="Search conversations"
                  value={chatSearch}
                  onChange={(event) => setChatSearch(event.target.value)}
                />
              )}
              {visibleChats.length > 0 ? (
                <div className="chat-list" aria-label="Local conversations">
                  {visibleChats.map((chat) => (
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
                      {chat.unreadCount > 0 && (
                        <span className="unread-count">{chat.unreadCount}</span>
                      )}
                    </button>
                  ))}
                  {chatsNextCursor !== null && (
                    <button
                      className="load-more"
                      type="button"
                      disabled={messagingLoading}
                      onClick={() => void loadMoreChats()}
                    >
                      Load more conversations
                    </button>
                  )}
                </div>
              ) : (
                <div className="empty-list">
                  <div className="empty-list-icon" aria-hidden="true">
                    ≡
                  </div>
                  <strong>
                    {messagingLoading
                      ? 'Loading conversations…'
                      : chatQuery.length > 0
                        ? 'No matching conversations'
                        : activeAccount
                          ? emptyChatStates[activeAccount.connectionState.kind].title
                          : 'No conversations yet'}
                  </strong>
                  <p>
                    {chatQuery.length > 0
                      ? 'Search filters the conversations already loaded locally.'
                      : activeAccount
                        ? emptyChatStates[activeAccount.connectionState.kind].body
                        : 'Add an account to start syncing conversations.'}
                  </p>
                </div>
              )}
            </>
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
                {messagesNextCursor !== null && (
                  <button
                    className="load-older"
                    type="button"
                    disabled={messagingLoading}
                    onClick={() => void loadOlderMessages()}
                  >
                    Load older messages
                  </button>
                )}
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
