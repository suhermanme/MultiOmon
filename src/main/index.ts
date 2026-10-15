import { join } from 'node:path';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, shell } from 'electron';
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

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.multiomon.desktop');
  registerIpcHandlers();

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
