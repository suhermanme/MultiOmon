import { BrowserWindow, ipcMain } from 'electron';
import type { AccountManager } from '../application/accounts/account-manager';
import { toAccountSnapshotDto } from '../application/accounts/account-view';
import type { MessagingService } from '../application/messaging/messaging-service';
import type { MessagingView } from '../application/messaging/messaging-view';
import { createAccountId, createChatId } from '../domain';
import { IPC_CHANNELS, type RuntimeInfo } from '../shared/contracts/desktop-api';

export function registerIpcHandlers(
  accountManager: AccountManager,
  messagingService: MessagingService,
  messagingView: MessagingView,
): () => void {
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

  ipcMain.handle(IPC_CHANNELS.chatList, (_event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Account ID must be a string');
    return messagingView.listChats(createAccountId(accountId));
  });

  ipcMain.handle(
    IPC_CHANNELS.messageList,
    (_event, accountId: unknown, chatId: unknown, limit: unknown) => {
      if (typeof accountId !== 'string') throw new TypeError('Account ID must be a string');
      if (typeof chatId !== 'string') throw new TypeError('Chat ID must be a string');
      if (limit !== undefined && typeof limit !== 'number') {
        throw new TypeError('Message limit must be a number');
      }
      return messagingView.listMessages(
        createAccountId(accountId),
        createChatId(chatId),
        limit ?? 50,
      );
    },
  );

  const unsubscribe = accountManager.subscribe((snapshot) => {
    const dto = toAccountSnapshotDto(snapshot);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.accountChanged, dto);
    }
  });
  const unsubscribeMessaging = messagingService.subscribe((change) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.messagingChanged, change);
    }
  });

  return () => {
    unsubscribe();
    unsubscribeMessaging();
    ipcMain.removeHandler(IPC_CHANNELS.runtimeInfo);
    ipcMain.removeHandler(IPC_CHANNELS.ping);
    ipcMain.removeHandler(IPC_CHANNELS.accountSnapshot);
    ipcMain.removeHandler(IPC_CHANNELS.accountSelect);
    ipcMain.removeHandler(IPC_CHANNELS.chatList);
    ipcMain.removeHandler(IPC_CHANNELS.messageList);
  };
}
