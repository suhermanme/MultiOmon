import { create } from 'zustand';
import type { PairingUpdateDto } from '../../shared/contracts/desktop-api';

interface PairingStoreState {
  readonly updates: Readonly<Record<string, PairingUpdateDto>>;
  readonly applyUpdate: (update: PairingUpdateDto) => void;
  readonly getUpdate: (accountId: string) => PairingUpdateDto | undefined;
  readonly reset: () => void;
}

export const usePairingStore = create<PairingStoreState>((set, get) => ({
  updates: {},
  applyUpdate: (update) => set({ updates: { ...get().updates, [update.accountId]: update } }),
  getUpdate: (accountId) => get().updates[accountId],
  reset: () => set({ updates: {} }),
}));

export function subscribePairing(): () => void {
  return window.multiomon.pairing.subscribe((update) => {
    usePairingStore.getState().applyUpdate(update);
  });
}
