import { create } from 'zustand';
import type { AccountSnapshotDto } from '../../shared/contracts/desktop-api';

interface AccountStoreState {
  readonly snapshot: AccountSnapshotDto;
  readonly loading: boolean;
  readonly error: string | null;
  readonly applySnapshot: (snapshot: AccountSnapshotDto) => void;
  readonly setLoadError: (message: string) => void;
  readonly selectAccount: (accountId: string) => Promise<void>;
}

const emptySnapshot: AccountSnapshotDto = { accounts: [], activeAccountId: null };

export const useAccountStore = create<AccountStoreState>((set) => ({
  snapshot: emptySnapshot,
  loading: true,
  error: null,
  applySnapshot: (snapshot) => set({ snapshot, loading: false, error: null }),
  setLoadError: (message) => set({ loading: false, error: message }),
  selectAccount: async (accountId) => {
    try {
      const snapshot = await window.multiomon.accounts.select(accountId);
      set({ snapshot, error: null });
    } catch {
      set({ error: 'Could not switch accounts. Please try again.' });
    }
  },
}));
