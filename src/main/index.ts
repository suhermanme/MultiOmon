import { join } from 'node:path';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, shell } from 'electron';
import { MessagingView } from '../application/messaging/messaging-view';
import { createRepositories, SqliteDatabase } from '../infrastructure/database';
import { LocalMediaFileStore } from '../infrastructure/storage';
import {
  bootstrapApplication,
  createMockMessagingProvider,
  createWhatsappMessagingProvider,
} from './bootstrap';
import { registerIpcHandlers } from './ipc';
import { createWindowOptions } from './window-options';

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow(createWindowOptions(join(__dirname, '../preload/index.js')));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

void app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.multiomon.desktop');
  const database = SqliteDatabase.open(
    join(app.getPath('userData'), 'database', 'multiomon.sqlite'),
  );
  const repositories = createRepositories(database);
  const useWhatsapp = process.env.WHATSAPP_PROVIDER === '1';
  const messagingProvider = useWhatsapp
    ? createWhatsappMessagingProvider(join(app.getPath('userData'), 'authInfo'))
    : createMockMessagingProvider();
  const { messagingService, accountManager, provisioning } = await bootstrapApplication({
    transactionRunner: database,
    repositories,
    messagingProvider,
    useWhatsapp,
    mediaFiles: new LocalMediaFileStore(join(app.getPath('userData'), 'media')),
  });
  const messagingView = new MessagingView(
    repositories.chats,
    repositories.messages,
    repositories.attachments,
    repositories.receipts,
  );
  const unregisterIpcHandlers = registerIpcHandlers({
    accountManager,
    messagingService,
    messagingView,
    provisioning,
  });
  app.once('before-quit', () => {
    unregisterIpcHandlers();
    messagingService.dispose();
    database.close();
  });

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
