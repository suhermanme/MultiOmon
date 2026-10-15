import type { DesktopApi } from '../../shared/contracts/desktop-api';

declare global {
  interface Window {
    readonly multiomon: DesktopApi;
  }
}

export {};
