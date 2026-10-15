export const IPC_CHANNELS = {
  runtimeInfo: 'system:runtime-info',
  ping: 'system:ping',
} as const;

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
}
