import { Fragment, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type {
  AccountConnectionStateDto,
  AccountSummaryDto,
  CreateAccountRequestDto,
  PairingUpdateDto,
  RuntimeInfo,
  MessageContentDto,
  MessageDto,
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
    body: 'Press Pair, then scan the QR code with WhatsApp to sync this account.',
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

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (dayKey(timestamp) === dayKey(today.getTime())) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(timestamp) === dayKey(yesterday.getTime())) return 'Yesterday';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function senderLabel(senderRemoteId: string): string {
  return senderRemoteId.split('@')[0] ?? senderRemoteId;
}

const RECEIPT_STATUS_LABELS: Record<NonNullable<MessageDto['receiptStatus']>, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  played: 'Played',
};

function fileSizeLabel(sizeBytes: number | undefined): string | null {
  if (sizeBytes === undefined) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MediaMessage({
  accountId,
  content,
}: {
  readonly accountId: string;
  readonly content: Extract<MessageContentDto, { kind: 'media' }>;
}): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const download = async (): Promise<void> => {
    if (loading || dataUrl) return;
    setLoading(true);
    setFailed(false);
    try {
      const media = await window.multiomon.messaging.downloadMedia(accountId, content.attachmentId);
      setDataUrl(media.dataUrl);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const name = content.fileName ?? `${content.attachmentKind} attachment`;
  const size = fileSizeLabel(content.sizeBytes);

  return (
    <div className="message-media">
      {dataUrl && (content.attachmentKind === 'image' || content.attachmentKind === 'sticker') ? (
        <img className="media-preview" src={dataUrl} alt={content.caption ?? name} />
      ) : dataUrl && content.attachmentKind === 'video' ? (
        <video className="media-preview" src={dataUrl} controls aria-label={name} />
      ) : dataUrl && content.attachmentKind === 'audio' ? (
        <audio className="media-audio" src={dataUrl} controls aria-label={name} />
      ) : dataUrl ? (
        <a className="media-download" href={dataUrl} download={content.fileName ?? 'attachment'}>
          Save {name}
        </a>
      ) : (
        <button
          className="media-download"
          type="button"
          disabled={loading}
          onClick={() => void download()}
        >
          {loading ? 'Downloading…' : `Download ${name}`}
        </button>
      )}
      <span className="media-meta">
        {content.attachmentKind}
        {size ? ` · ${size}` : ''}
        {failed ? ' · download failed' : ''}
      </span>
      {content.caption ? <p>{content.caption}</p> : null}
    </div>
  );
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

function AddAccountDialog({ busy, onCreate }: AddAccountFormProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const name = displayName.trim();
  const phone = phoneNumber.trim();

  useEffect(() => {
    if (!open) return;
    nameInput.current?.focus();
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !submitting) setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, submitting]);

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
    setOpen(false);
  };

  return (
    <>
      <button
        className="add-account-trigger"
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">+</span>
        Add account
      </button>
      {open ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) setOpen(false);
          }}
        >
          <section
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-account-title"
          >
            <header className="dialog-header">
              <div>
                <span className="section-label">New connection</span>
                <h2 id="add-account-title">Add an account</h2>
              </div>
              <button
                className="dialog-close"
                type="button"
                aria-label="Close add account dialog"
                disabled={submitting}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            <p className="dialog-intro">
              Give this WhatsApp account a recognizable name. You can pair it after it is added.
            </p>
            <form className="add-account-form" onSubmit={(event) => void handleSubmit(event)}>
              <label htmlFor="new-account-name">Account name</label>
              <input
                ref={nameInput}
                id="new-account-name"
                className="text-input"
                value={displayName}
                placeholder="Personal"
                autoComplete="off"
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <label htmlFor="new-account-phone">
                Phone number <span>Optional</span>
              </label>
              <input
                id="new-account-phone"
                className="text-input"
                value={phoneNumber}
                placeholder="+1 555 123 4567"
                inputMode="tel"
                autoComplete="tel"
                onChange={(event) => setPhoneNumber(event.target.value)}
              />
              <div className="dialog-actions">
                <button
                  className="dialog-cancel"
                  type="button"
                  disabled={submitting}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="add-account-submit"
                  type="submit"
                  disabled={name === '' || submitting || busy}
                >
                  {submitting ? 'Adding…' : 'Add account'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
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
          <p>In WhatsApp, choose Linked devices → Link with phone number, then enter this code.</p>
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
    requestEarlierHistory,
    historyLoading,
    sending,
    sendError,
    pendingMessage,
    sendText,
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
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const chatQuery = chatSearch.trim().toLowerCase();
  const visibleChats =
    chatQuery.length === 0
      ? chats
      : chats.filter((chat) => chat.title.toLowerCase().includes(chatQuery));

  const selectedChat = chats.find((chat) => chat.id === selectedChatId) ?? null;
  const replyTarget = messages.find((message) => message.id === replyToMessageId) ?? null;
  const activeAccountId = activeAccount?.id;
  const accountConnected = activeAccount?.connectionState.kind === 'connected';
  const selectedChatUnreadCount = selectedChat?.unreadCount ?? 0;

  useEffect(() => {
    if (!activeAccountId || !accountConnected || !selectedChatId || selectedChatUnreadCount === 0) {
      return;
    }
    void window.multiomon.messaging
      .markRead(activeAccountId, selectedChatId)
      .catch(() => undefined);
  }, [accountConnected, activeAccountId, selectedChatId, selectedChatUnreadCount]);

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
          <span className="bridge-dot" aria-hidden="true" />
          {bridgeStatus.kind === 'ready' ? (
            <>
              <strong className="provider-label">
                {bridgeStatus.runtime.messagingProvider === 'whatsapp'
                  ? 'WhatsApp live'
                  : 'Mock mode'}
              </strong>
              <span className="bridge-separator" aria-hidden="true">
                ·
              </span>
              <span>Desktop ready</span>
            </>
          ) : bridgeStatus.kind === 'failed' ? (
            'Desktop unavailable'
          ) : (
            'Starting…'
          )}
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
          <AddAccountDialog busy={pendingAction !== null} onCreate={createAccount} />
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
                {messagesNextCursor === null &&
                  messages.length > 0 &&
                  activeAccount?.connectionState.kind === 'connected' && (
                    <button
                      className="load-older"
                      type="button"
                      disabled={historyLoading}
                      onClick={() => void requestEarlierHistory()}
                    >
                      {historyLoading ? 'Requesting history…' : 'Fetch earlier history'}
                    </button>
                  )}
                {messages.map((message, index) => {
                  const previous = messages[index - 1];
                  const startsDay = !previous || dayKey(previous.sentAt) !== dayKey(message.sentAt);
                  return (
                    <Fragment key={message.id}>
                      {startsDay ? (
                        <div className="date-separator">{dayLabel(message.sentAt)}</div>
                      ) : null}
                      <article className={`message-bubble message-${message.direction}`}>
                        {message.replyToMessageId && (
                          <span className="reply-quote">
                            {(() => {
                              const original = messages.find(
                                ({ id }) => id === message.replyToMessageId,
                              );
                              if (!original) return 'Reply to an earlier message';
                              return original.content.kind === 'media'
                                ? 'Reply to media'
                                : original.content.text;
                            })()}
                          </span>
                        )}
                        {message.content.kind === 'system' ? (
                          <span className="message-kind">System</span>
                        ) : message.direction === 'incoming' && message.senderRemoteId ? (
                          <span className="message-sender">
                            {senderLabel(message.senderRemoteId)}
                          </span>
                        ) : null}
                        {message.content.kind === 'media' ? (
                          <MediaMessage accountId={message.accountId} content={message.content} />
                        ) : (
                          <p>{message.content.text}</p>
                        )}
                        <button
                          className="message-reply"
                          type="button"
                          onClick={() => setReplyToMessageId(message.id)}
                        >
                          Reply
                        </button>
                        {message.direction === 'outgoing' && message.receiptStatus ? (
                          <span
                            className={`receipt-status receipt-${message.receiptStatus}`}
                            aria-label={RECEIPT_STATUS_LABELS[message.receiptStatus]}
                            title={RECEIPT_STATUS_LABELS[message.receiptStatus]}
                          >
                            {message.receiptStatus === 'sent' ? '✓' : '✓✓'}
                          </span>
                        ) : null}
                        <time
                          className="message-time"
                          dateTime={new Date(message.sentAt).toISOString()}
                        >
                          {new Date(message.sentAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </article>
                    </Fragment>
                  );
                })}
                {pendingMessage?.chatId === selectedChat.id && (
                  <article
                    className="message-bubble message-outgoing message-pending"
                    aria-label="Sending message"
                  >
                    {pendingMessage.replyToMessageId && (
                      <span className="reply-quote">Replying to a message</span>
                    )}
                    <p>{pendingMessage.text}</p>
                    <span className="message-time">Sending…</span>
                  </article>
                )}
              </div>
              <MessageComposer
                connected={activeAccount?.connectionState.kind === 'connected'}
                sending={sending}
                error={sendError}
                replyTarget={replyTarget}
                onCancelReply={() => setReplyToMessageId(null)}
                onSend={async (text, replyId) => {
                  const sent = await sendText(text, replyId);
                  if (sent) setReplyToMessageId(null);
                  return sent;
                }}
              />
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

function MessageComposer({
  connected,
  sending,
  error,
  replyTarget,
  onCancelReply,
  onSend,
}: {
  readonly connected: boolean;
  readonly sending: boolean;
  readonly error: string | null;
  readonly replyTarget: MessageDto | null;
  readonly onCancelReply: () => void;
  readonly onSend: (text: string, replyToMessageId?: string) => Promise<boolean>;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const submit = async (): Promise<void> => {
    if (!connected || sending || draft.trim().length === 0) return;
    if (await onSend(draft, replyTarget?.id)) setDraft('');
  };
  return (
    <form
      className="message-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      {replyTarget && (
        <div className="reply-preview">
          <span>
            <strong>Replying to</strong>{' '}
            {replyTarget.content.kind === 'media' ? '[Media]' : replyTarget.content.text}
          </span>
          <button type="button" aria-label="Cancel reply" onClick={onCancelReply}>
            ×
          </button>
        </div>
      )}
      <div className="composer-input-row">
        <textarea
          aria-label="Message"
          placeholder={connected ? 'Write a message…' : 'Connect this account to send a message'}
          value={draft}
          disabled={!connected || sending}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button type="submit" disabled={!connected || sending || draft.trim().length === 0}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
    </form>
  );
}
