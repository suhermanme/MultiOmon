import { BrowserWindow, ipcMain } from 'electron';
import type { AccountManager } from '../application/accounts/account-manager';
import { toAccountSnapshotDto } from '../application/accounts/account-view';
import type { AccountProvisioningService } from '../application/accounts/account-provisioning';
import type { MessagingService } from '../application/messaging/messaging-service';
import { toPairingUpdateDto, type MessagingView } from '../application/messaging/messaging-view';
import { createAccountId, createAttachmentId, createChatId, type AccountId } from '../domain';
import {
  IPC_CHANNELS,
  type AccountConnectionStateDto,
  type AccountSnapshotDto,
  type ChatPageOptionsDto,
  type MessagePageOptionsDto,
  type MessagingChangeDto,
  type RuntimeInfo,
} from '../shared/contracts/desktop-api';

export interface IpcServices {
  readonly accountManager: AccountManager;
  readonly messagingService: MessagingService;
  readonly messagingView: MessagingView;
  readonly provisioning: AccountProvisioningService;
}

function readAccountId(accountId: unknown): AccountId {
  if (typeof accountId !== 'string') throw new TypeError('Account ID must be a string');
  return createAccountId(accountId);
}

function readAccountRequest(request: unknown): { displayName: string; phoneNumber?: string } {
  if (typeof request !== 'object' || request === null) {
    throw new TypeError('Account request must be an object');
  }
  const { displayName, phoneNumber } = request as {
    displayName?: unknown;
    phoneNumber?: unknown;
  };
  if (typeof displayName !== 'string') throw new TypeError('Account name must be a string');
  if (phoneNumber !== undefined && typeof phoneNumber !== 'string') {
    throw new TypeError('Phone number must be a string');
  }
  return { displayName, ...(typeof phoneNumber === 'string' ? { phoneNumber } : {}) };
}

function readChatPageOptions(options: unknown): ChatPageOptionsDto {
  if (options === undefined || options === null) return {};
  if (typeof options !== 'object') throw new TypeError('Chat page options must be an object');
  const { limit, cursor } = options as { limit?: unknown; cursor?: unknown };
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit))) {
    throw new TypeError('Chat page limit must be an integer');
  }
  if (cursor === undefined || cursor === null) {
    return limit === undefined ? {} : { limit };
  }
  if (typeof cursor !== 'object') throw new TypeError('Chat page cursor must be an object');
  const { lastActivityAt, chatId } = cursor as { lastActivityAt?: unknown; chatId?: unknown };
  if (typeof lastActivityAt !== 'number' || typeof chatId !== 'string') {
    throw new TypeError('Chat page cursor must carry a numeric lastActivityAt and string chatId');
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    cursor: { lastActivityAt, chatId },
  };
}

function readMessagePageOptions(options: unknown): MessagePageOptionsDto {
  if (options === undefined || options === null) return {};
  if (typeof options !== 'object') throw new TypeError('Message page options must be an object');
  const { limit, cursor } = options as { limit?: unknown; cursor?: unknown };
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit))) {
    throw new TypeError('Message page limit must be an integer');
  }
  if (cursor === undefined || cursor === null) {
    return limit === undefined ? {} : { limit };
  }
  if (typeof cursor !== 'object') throw new TypeError('Message page cursor must be an object');
  const { sentAt, messageId } = cursor as { sentAt?: unknown; messageId?: unknown };
  if (typeof sentAt !== 'number' || typeof messageId !== 'string') {
    throw new TypeError('Message page cursor must carry a numeric sentAt and string messageId');
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    cursor: { sentAt, messageId },
  };
}

function sendToWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

const CLOSED_PAIRING_STATES: readonly AccountConnectionStateDto['kind'][] = [
  'connected',
  'disconnected',
  'failed',
];

export function registerIpcHandlers(services: IpcServices): () => void {
  const { accountManager, messagingService, messagingView, provisioning } = services;
  const pairingStates = new Map<string, AccountConnectionStateDto['kind']>();

  const publishAccounts = (snapshot: AccountSnapshotDto): void => {
    sendToWindows(IPC_CHANNELS.accountChanged, snapshot);

    const liveAccountIds = new Set<string>();
    for (const account of snapshot.accounts) {
      liveAccountIds.add(account.id);
      const previous = pairingStates.get(account.id);
      pairingStates.set(account.id, account.connectionState.kind);
      // A pairing panel is only worth closing once it was actually open: pairing
      // ends when the account connects, fails, or drops the socket.
      if (previous === undefined || previous === account.connectionState.kind) continue;
      if (CLOSED_PAIRING_STATES.includes(account.connectionState.kind)) {
        sendToWindows(IPC_CHANNELS.pairingChanged, { accountId: account.id, kind: 'cleared' });
      }
    }
    for (const accountId of [...pairingStates.keys()]) {
      if (liveAccountIds.has(accountId)) continue;
      pairingStates.delete(accountId);
      sendToWindows(IPC_CHANNELS.pairingChanged, { accountId, kind: 'cleared' });
    }
  };

  ipcMain.handle(IPC_CHANNELS.runtimeInfo, (): RuntimeInfo => {
    return {
      platform: process.platform,
      messagingProvider: process.env.WHATSAPP_PROVIDER === '1' ? 'whatsapp' : 'mock',
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
    accountManager.selectAccount(readAccountId(accountId));
    return toAccountSnapshotDto(accountManager.getSnapshot());
  });

  ipcMain.handle(IPC_CHANNELS.accountCreate, (_event, request: unknown) => {
    provisioning.createAccount(readAccountRequest(request));
    return toAccountSnapshotDto(accountManager.getSnapshot());
  });

  ipcMain.handle(IPC_CHANNELS.accountRemove, async (_event, accountId: unknown) => {
    await provisioning.removeAccount(readAccountId(accountId));
    return toAccountSnapshotDto(accountManager.getSnapshot());
  });

  ipcMain.handle(IPC_CHANNELS.accountLogout, async (_event, accountId: unknown) => {
    await provisioning.logoutAccount(readAccountId(accountId));
    return toAccountSnapshotDto(accountManager.getSnapshot());
  });

  ipcMain.handle(IPC_CHANNELS.accountPair, async (_event, accountId: unknown) => {
    await provisioning.startPairing(readAccountId(accountId));
  });

  ipcMain.handle(IPC_CHANNELS.accountConnect, async (_event, accountId: unknown) => {
    await provisioning.connectAccount(readAccountId(accountId));
  });

  ipcMain.handle(IPC_CHANNELS.chatList, (_event, accountId: unknown, options: unknown) => {
    return messagingView.listChats(readAccountId(accountId), readChatPageOptions(options));
  });

  ipcMain.handle(
    IPC_CHANNELS.messageList,
    (_event, accountId: unknown, chatId: unknown, options: unknown) => {
      if (typeof chatId !== 'string') throw new TypeError('Chat ID must be a string');
      return messagingView.listMessages(
        readAccountId(accountId),
        createChatId(chatId),
        readMessagePageOptions(options),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.messageHistory,
    async (_event, accountId: unknown, chatId: unknown) => {
      if (typeof chatId !== 'string') throw new TypeError('Chat ID must be a string');
      await messagingService.requestHistory(readAccountId(accountId), createChatId(chatId));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.mediaDownload,
    async (_event, accountId: unknown, attachmentId: unknown) => {
      if (typeof attachmentId !== 'string') {
        throw new TypeError('Attachment ID must be a string');
      }
      const downloaded = await messagingService.downloadAttachment(
        readAccountId(accountId),
        createAttachmentId(attachmentId),
      );
      return {
        attachmentId: downloaded.attachmentId,
        kind: downloaded.kind,
        mediaType: downloaded.mediaType,
        dataUrl: `data:${downloaded.mediaType};base64,${Buffer.from(downloaded.bytes).toString('base64')}`,
        ...(downloaded.fileName === undefined ? {} : { fileName: downloaded.fileName }),
      };
    },
  );

  const unsubscribe = accountManager.subscribe((snapshot) => {
    publishAccounts(toAccountSnapshotDto(snapshot));
  });
  // History hydration projects thousands of events in one synchronous burst;
  // coalescing per chat keeps one IPC batch (and one renderer reload) per burst.
  let pendingChanges: Map<string, MessagingChangeDto> | undefined;
  const flushMessagingChanges = (): void => {
    const batch = pendingChanges;
    pendingChanges = undefined;
    if (!batch || batch.size === 0) return;
    sendToWindows(IPC_CHANNELS.messagingChanged, [...batch.values()]);
  };
  const unsubscribeMessaging = messagingService.subscribe((change) => {
    if (!pendingChanges) {
      pendingChanges = new Map();
      queueMicrotask(flushMessagingChanges);
    }
    pendingChanges.set(`${change.accountId}\u0000${change.chatId}`, change);
  });
  const unsubscribePairing = messagingService.subscribePairing((event) => {
    sendToWindows(IPC_CHANNELS.pairingChanged, toPairingUpdateDto(event));
  });

  return () => {
    pendingChanges = undefined;
    unsubscribe();
    unsubscribeMessaging();
    unsubscribePairing();
    pairingStates.clear();
    ipcMain.removeHandler(IPC_CHANNELS.runtimeInfo);
    ipcMain.removeHandler(IPC_CHANNELS.ping);
    ipcMain.removeHandler(IPC_CHANNELS.accountSnapshot);
    ipcMain.removeHandler(IPC_CHANNELS.accountSelect);
    ipcMain.removeHandler(IPC_CHANNELS.accountCreate);
    ipcMain.removeHandler(IPC_CHANNELS.accountRemove);
    ipcMain.removeHandler(IPC_CHANNELS.accountLogout);
    ipcMain.removeHandler(IPC_CHANNELS.accountPair);
    ipcMain.removeHandler(IPC_CHANNELS.accountConnect);
    ipcMain.removeHandler(IPC_CHANNELS.chatList);
    ipcMain.removeHandler(IPC_CHANNELS.messageList);
    ipcMain.removeHandler(IPC_CHANNELS.messageHistory);
    ipcMain.removeHandler(IPC_CHANNELS.mediaDownload);
  };
}
