import { BrowserWindow, ipcMain } from 'electron';
import type { AccountManager } from '../application/accounts/account-manager';
import { toAccountSnapshotDto } from '../application/accounts/account-view';
import { createAccountId } from '../domain';
import { IPC_CHANNELS, type RuntimeInfo } from '../shared/contracts/desktop-api';

export function registerIpcHandlers(accountManager: AccountManager): () => void {
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

  ipcMain.handle(IPC_CHANNELS.accountSnapshot, () => {
    return toAccountSnapshotDto(accountManager.getSnapshot());
  });

  ipcMain.handle(IPC_CHANNELS.accountSelect, (_event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Account ID must be a string');
    accountManager.selectAccount(createAccountId(accountId));
    return toAccountSnapshotDto(accountManager.getSnapshot());
  });

  const unsubscribe = accountManager.subscribe((snapshot) => {
    const dto = toAccountSnapshotDto(snapshot);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.accountChanged, dto);
    }
  });

  return () => {
    unsubscribe();
    ipcMain.removeHandler(IPC_CHANNELS.runtimeInfo);
    ipcMain.removeHandler(IPC_CHANNELS.ping);
    ipcMain.removeHandler(IPC_CHANNELS.accountSnapshot);
    ipcMain.removeHandler(IPC_CHANNELS.accountSelect);
  };
}
