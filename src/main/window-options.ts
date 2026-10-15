import type { BrowserWindowConstructorOptions } from 'electron';

export function createWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: '#101715',
    title: 'MultiOmon',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}
