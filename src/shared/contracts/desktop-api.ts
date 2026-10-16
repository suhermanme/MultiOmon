export const IPC_CHANNELS = {
  runtimeInfo: 'system:runtime-info',
  ping: 'system:ping',
  accountSnapshot: 'accounts:snapshot',
  accountSelect: 'accounts:select',
  accountCreate: 'accounts:create',
  accountRemove: 'accounts:remove',
  accountLogout: 'accounts:logout',
  accountPair: 'accounts:pair',
  accountConnect: 'accounts:connect',
  accountChanged: 'accounts:changed',
  pairingChanged: 'pairing:changed',
  chatList: 'messaging:chats',
  messageList: 'messaging:messages',
  messageHistory: 'messaging:history',
  mediaDownload: 'messaging:media-download',
  messagingChanged: 'messaging:changed',
} as const;

export type AccountConnectionStateDto =
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

export interface AccountSummaryDto {
  readonly id: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly connectionState: AccountConnectionStateDto;
  readonly phoneNumber?: string;
}

export interface CreateAccountRequestDto {
  readonly displayName: string;
  readonly phoneNumber?: string;
}

export type PairingUpdateDto =
  | {
      readonly accountId: string;
      readonly kind: 'code';
      readonly code: string;
      readonly expiresAt: number;
    }
  | { readonly accountId: string; readonly kind: 'qr'; readonly payload: string }
  | { readonly accountId: string; readonly kind: 'cleared' };

export interface AccountSnapshotDto {
  readonly accounts: readonly AccountSummaryDto[];
  readonly activeAccountId: string | null;
}

export interface ChatSummaryDto {
  readonly id: string;
  readonly accountId: string;
  readonly title: string;
  readonly kind: 'direct' | 'group';
  readonly unreadCount: number;
  readonly lastActivityAt?: number;
}

export type MessageContentDto =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'system'; readonly text: string }
  | {
      readonly kind: 'media';
      readonly attachmentId: string;
      readonly attachmentKind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
      readonly mediaType: string;
      readonly fileName?: string;
      readonly sizeBytes?: number;
      readonly caption?: string;
    };

export interface MessageDto {
  readonly id: string;
  readonly accountId: string;
  readonly chatId: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly senderRemoteId?: string;
  readonly sentAt: number;
  readonly content: MessageContentDto;
}

export interface MessagingChangeDto {
  readonly accountId: string;
  readonly chatId: string;
}

export interface ChatPageCursorDto {
  readonly lastActivityAt: number;
  readonly chatId: string;
}

export interface ChatPageOptionsDto {
  readonly limit?: number;
  readonly cursor?: ChatPageCursorDto | null;
}

export interface ChatPageDto {
  readonly items: readonly ChatSummaryDto[];
  readonly nextCursor: ChatPageCursorDto | null;
}

export interface MessagePageCursorDto {
  readonly sentAt: number;
  readonly messageId: string;
}

export interface MessagePageOptionsDto {
  readonly limit?: number;
  readonly cursor?: MessagePageCursorDto | null;
}

export interface MessagePageDto {
  readonly items: readonly MessageDto[];
  readonly nextCursor: MessagePageCursorDto | null;
}

export interface MediaDownloadDto {
  readonly attachmentId: string;
  readonly kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  readonly mediaType: string;
  readonly dataUrl: string;
  readonly fileName?: string;
}

export interface RuntimeInfo {
  readonly platform: string;
  readonly messagingProvider: 'mock' | 'whatsapp';
  readonly versions: {
    readonly chrome: string;
    readonly electron: string;
    readonly node: string;
  };
}

export interface DesktopApi {
  readonly getRuntimeInfo: () => Promise<RuntimeInfo>;
  readonly ping: () => Promise<'pong'>;
  readonly accounts: {
    readonly getSnapshot: () => Promise<AccountSnapshotDto>;
    readonly select: (accountId: string) => Promise<AccountSnapshotDto>;
    readonly create: (request: CreateAccountRequestDto) => Promise<AccountSnapshotDto>;
    readonly remove: (accountId: string) => Promise<AccountSnapshotDto>;
    readonly logout: (accountId: string) => Promise<AccountSnapshotDto>;
    readonly pair: (accountId: string) => Promise<void>;
    readonly connect: (accountId: string) => Promise<void>;
    readonly subscribe: (listener: (snapshot: AccountSnapshotDto) => void) => () => void;
  };
  readonly pairing: {
    readonly subscribe: (listener: (update: PairingUpdateDto) => void) => () => void;
  };
  readonly messaging: {
    readonly listChats: (accountId: string, options?: ChatPageOptionsDto) => Promise<ChatPageDto>;
    readonly listMessages: (
      accountId: string,
      chatId: string,
      options?: MessagePageOptionsDto,
    ) => Promise<MessagePageDto>;
    readonly requestHistory: (accountId: string, chatId: string) => Promise<void>;
    readonly downloadMedia: (accountId: string, attachmentId: string) => Promise<MediaDownloadDto>;
    readonly subscribe: (listener: (changes: readonly MessagingChangeDto[]) => void) => () => void;
  };
}
