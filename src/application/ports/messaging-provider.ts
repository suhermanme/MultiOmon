import type { AccountId } from '../../domain';

export type ProviderConnectionState =
  | { readonly kind: 'idle'; readonly changedAt: number }
  | { readonly kind: 'needsPairing'; readonly changedAt: number }
  | { readonly kind: 'connecting'; readonly changedAt: number; readonly attempt: number }
  | { readonly kind: 'connected'; readonly changedAt: number; readonly connectedAt: number }
  | { readonly kind: 'disconnected'; readonly changedAt: number; readonly reason?: string }
  | {
      readonly kind: 'failed';
      readonly changedAt: number;
      readonly errorCode: string;
      readonly message: string;
    };

export interface ProviderChat {
  readonly accountId: AccountId;
  readonly remoteId: string;
  readonly kind: 'direct' | 'group';
  readonly title: string;
  readonly unreadCount: number;
  readonly lastActivityAt?: number;
}

export interface ProviderMediaContent {
  readonly kind: 'media';
  readonly attachmentKind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  readonly mediaType: string;
  readonly remoteReference: string;
  readonly fileName?: string;
  readonly sizeBytes?: number;
  readonly caption?: string;
}

export type ProviderMessageContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'system'; readonly text: string }
  | ProviderMediaContent;

export interface ProviderMessage {
  readonly accountId: AccountId;
  readonly remoteId: string;
  readonly chatRemoteId: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly senderRemoteId?: string;
  readonly sentAt: number;
  readonly content: ProviderMessageContent;
  readonly replyToRemoteMessageId?: string;
}

export type MessagingEvent =
  | { readonly type: 'connection.changed'; readonly state: ProviderConnectionState }
  | {
      readonly type: 'pairing.code';
      readonly accountId: AccountId;
      readonly code: string;
      readonly expiresAt: number;
    }
  | {
      readonly type: 'pairing.qr';
      readonly accountId: AccountId;
      readonly payload: string;
    }
  | { readonly type: 'chat.upserted'; readonly chat: ProviderChat }
  | { readonly type: 'message.upserted'; readonly message: ProviderMessage };

export interface SendTextRequest {
  readonly chatRemoteId: string;
  readonly text: string;
  readonly replyToRemoteMessageId?: string;
}

export interface HistoryRequest {
  readonly chatRemoteId: string;
  readonly oldestRemoteMessageId: string;
  readonly oldestDirection: 'incoming' | 'outgoing';
  readonly oldestSentAt: number;
  readonly count: number;
}

export type MessagingEventListener = (event: MessagingEvent) => void;
export type Unsubscribe = () => void;

export interface MessagingSession {
  readonly accountId: AccountId;
  getConnectionState(): ProviderConnectionState;
  startPairing(): Promise<void>;
  connect(): Promise<void>;
  disconnect(reason?: string): Promise<void>;
  logout(): Promise<void>;
  sendText(request: SendTextRequest): Promise<ProviderMessage>;
  requestHistory(request: HistoryRequest): Promise<void>;
  downloadMedia(remoteReference: string): Promise<Uint8Array>;
  subscribe(listener: MessagingEventListener): Unsubscribe;
  dispose(): void;
}

export interface MessagingProvider {
  createSession(accountId: AccountId): MessagingSession;
}

export class ProviderError extends Error {
  readonly code: string;
  readonly accountId: AccountId;

  constructor(accountId: AccountId, code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderError';
    this.accountId = accountId;
    this.code = code;
  }
}
