import { ipcMain } from 'electron';
import { IPC_CHANNELS, type RuntimeInfo } from '../shared/contracts/desktop-api';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.runtimeInfo, (): RuntimeInfo => {
    return {
      platform: process.platform,
      versions: {
        chrome: process.versions.chrome,
        electron: process.versions.electron,
        node: process.versions.node,
      },
    };
  });

  ipcMain.handle(IPC_CHANNELS.ping, (): 'pong' => 'pong');
}
