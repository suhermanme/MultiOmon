export const IPC_CHANNELS = {
  runtimeInfo: 'system:runtime-info',
  ping: 'system:ping',
  accountSnapshot: 'accounts:snapshot',
  accountSelect: 'accounts:select',
  accountChanged: 'accounts:changed',
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
}
