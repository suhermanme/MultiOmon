import { create } from 'zustand';
import type {
  AccountSnapshotDto,
  CreateAccountRequestDto,
} from '../../shared/contracts/desktop-api';

const emptySnapshot: AccountSnapshotDto = { accounts: [], activeAccountId: null };

function actionErrorMessage(reason: unknown, fallback: string): string {
  if (!(reason instanceof Error) || reason.message.trim() === '') return fallback;
  const message = reason.message.replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    '',
  );
  return /^Connection Closed$/i.test(message) ? fallback : message;
}

export type AccountActionKind = 'create' | 'pair' | 'connect' | 'logout' | 'remove';

interface AccountStoreState {
  readonly snapshot: AccountSnapshotDto;
  readonly loading: boolean;
  readonly error: string | null;
  readonly pendingAction: AccountActionKind | null;
  readonly applySnapshot: (snapshot: AccountSnapshotDto) => void;
  readonly setLoadError: (message: string) => void;
  readonly selectAccount: (accountId: string) => Promise<void>;
  readonly createAccount: (request: CreateAccountRequestDto) => Promise<boolean>;
  readonly removeAccount: (accountId: string) => Promise<void>;
  readonly logoutAccount: (accountId: string) => Promise<void>;
  readonly pairAccount: (accountId: string) => Promise<void>;
  readonly connectAccount: (accountId: string) => Promise<void>;
}

export const useAccountStore = create<AccountStoreState>((set) => {
  async function runAction(
    kind: AccountActionKind,
    request: () => Promise<AccountSnapshotDto>,
    fallback: string,
  ): Promise<AccountSnapshotDto | null> {
    set({ pendingAction: kind, error: null });
    try {
      const snapshot = await request();
      set({ snapshot, loading: false, error: null, pendingAction: null });
      return snapshot;
    } catch (reason) {
      set({
        loading: false,
        error: actionErrorMessage(reason, fallback),
        pendingAction: null,
      });
      return null;
    }
  }

  async function requestLifecycleSnapshot(call: () => Promise<void>): Promise<AccountSnapshotDto> {
    await call();
    return await window.multiomon.accounts.getSnapshot();
  }

  return {
    snapshot: emptySnapshot,
    loading: true,
    error: null,
    pendingAction: null,
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
    createAccount: async (request) => {
      const snapshot = await runAction(
        'create',
        () => window.multiomon.accounts.create(request),
        'Could not add this account. Please try again.',
      );
      return snapshot !== null;
    },
    removeAccount: async (accountId) => {
      await runAction(
        'remove',
        () => window.multiomon.accounts.remove(accountId),
        'Could not remove this account. Please try again.',
      );
    },
    logoutAccount: async (accountId) => {
      await runAction(
        'logout',
        () => window.multiomon.accounts.logout(accountId),
        'Could not log this account out. Please try again.',
      );
    },
    pairAccount: async (accountId) => {
      await runAction(
        'pair',
        () => requestLifecycleSnapshot(() => window.multiomon.accounts.pair(accountId)),
        'Could not start pairing for this account. Please try again.',
      );
    },
    connectAccount: async (accountId) => {
      await runAction(
        'connect',
        () => requestLifecycleSnapshot(() => window.multiomon.accounts.connect(accountId)),
        'Could not connect this account. Please try again.',
      );
    },
  };
});
