export const IPC_CHANNELS = {
  runtimeInfo: 'system:runtime-info',
  ping: 'system:ping',
  accountSnapshot: 'accounts:snapshot',
  accountSelect: 'accounts:select',
  accountChanged: 'accounts:changed',
  chatList: 'messaging:chats',
  messageList: 'messaging:messages',
  messagingChanged: 'messaging:changed',
} as const;

export type AccountConnectionStateDto =
  'idle' | 'needsPairing' | 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface AccountSummaryDto {
  readonly id: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly connectionState: AccountConnectionStateDto;
}

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
  | { readonly kind: 'media'; readonly attachmentId: string; readonly caption?: string };

export interface MessageDto {
  readonly id: string;
  readonly accountId: string;
  readonly chatId: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly sentAt: number;
  readonly content: MessageContentDto;
}

export interface MessagingChangeDto {
  readonly accountId: string;
  readonly chatId: string;
}

export interface RuntimeInfo {
  readonly platform: string;
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
    readonly subscribe: (listener: (snapshot: AccountSnapshotDto) => void) => () => void;
  };
  readonly messaging: {
    readonly listChats: (accountId: string) => Promise<readonly ChatSummaryDto[]>;
    readonly listMessages: (
      accountId: string,
      chatId: string,
      limit?: number,
    ) => Promise<readonly MessageDto[]>;
    readonly subscribe: (listener: (change: MessagingChangeDto) => void) => () => void;
  };
}
