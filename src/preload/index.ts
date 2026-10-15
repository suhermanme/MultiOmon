import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type DesktopApi, type RuntimeInfo } from '../shared/contracts/desktop-api';

const desktopApi: DesktopApi = Object.freeze({
  getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeInfo) as Promise<RuntimeInfo>,
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping) as Promise<'pong'>,
});

contextBridge.exposeInMainWorld('multiomon', desktopApi);
