import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AccountSnapshotDto,
  type ChatPageDto,
  type ChatPageOptionsDto,
  type CreateAccountRequestDto,
  type DesktopApi,
  type MessagePageDto,
  type MessagePageOptionsDto,
  type MessagingChangeDto,
  type PairingUpdateDto,
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
    create: (request: CreateAccountRequestDto) =>
      ipcRenderer.invoke(IPC_CHANNELS.accountCreate, request) as Promise<AccountSnapshotDto>,
    remove: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.accountRemove, accountId) as Promise<AccountSnapshotDto>,
    logout: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.accountLogout, accountId) as Promise<AccountSnapshotDto>,
    pair: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.accountPair, accountId) as Promise<void>,
    connect: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.accountConnect, accountId) as Promise<void>,
    subscribe: (listener: (snapshot: AccountSnapshotDto) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: AccountSnapshotDto): void => {
        listener(snapshot);
      };
      ipcRenderer.on(IPC_CHANNELS.accountChanged, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.accountChanged, handler);
    },
  }),
  pairing: Object.freeze({
    subscribe: (listener: (update: PairingUpdateDto) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, update: PairingUpdateDto): void => {
        listener(update);
      };
      ipcRenderer.on(IPC_CHANNELS.pairingChanged, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.pairingChanged, handler);
    },
  }),
  messaging: Object.freeze({
    listChats: (accountId: string, options?: ChatPageOptionsDto) =>
      ipcRenderer.invoke(IPC_CHANNELS.chatList, accountId, options) as Promise<ChatPageDto>,
    listMessages: (accountId: string, chatId: string, options?: MessagePageOptionsDto) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.messageList,
        accountId,
        chatId,
        options,
      ) as Promise<MessagePageDto>,
    subscribe: (listener: (changes: readonly MessagingChangeDto[]) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        changes: readonly MessagingChangeDto[],
      ): void => {
        listener(changes);
      };
      ipcRenderer.on(IPC_CHANNELS.messagingChanged, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.messagingChanged, handler);
    },
  }),
});

contextBridge.exposeInMainWorld('multiomon', desktopApi);
