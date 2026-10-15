import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AccountSnapshotDto,
  type DesktopApi,
  type ChatSummaryDto,
  type MessageDto,
  type MessagingChangeDto,
  type RuntimeInfo,
} from '../shared/contracts/desktop-api';

const desktopApi: DesktopApi = Object.freeze({
  getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeInfo) as Promise<RuntimeInfo>,
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping) as Promise<'pong'>,
  accounts: Object.freeze({
    getSnapshot: () =>
      ipcRenderer.invoke(IPC_CHANNELS.accountSnapshot) as Promise<AccountSnapshotDto>,
    select: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.accountSelect, accountId) as Promise<AccountSnapshotDto>,
    subscribe: (listener: (snapshot: AccountSnapshotDto) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: AccountSnapshotDto): void => {
        listener(snapshot);
      };
      ipcRenderer.on(IPC_CHANNELS.accountChanged, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.accountChanged, handler);
    },
  }),
  messaging: Object.freeze({
    listChats: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.chatList, accountId) as Promise<readonly ChatSummaryDto[]>,
    listMessages: (accountId: string, chatId: string, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.messageList, accountId, chatId, limit) as Promise<
        readonly MessageDto[]
      >,
    subscribe: (listener: (change: MessagingChangeDto) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, change: MessagingChangeDto): void => {
        listener(change);
      };
      ipcRenderer.on(IPC_CHANNELS.messagingChanged, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.messagingChanged, handler);
    },
  }),
});

contextBridge.exposeInMainWorld('multiomon', desktopApi);
