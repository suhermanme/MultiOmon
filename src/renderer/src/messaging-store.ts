import { create } from 'zustand';
import type {
  ChatSummaryDto,
  MessageDto,
  MessagingChangeDto,
} from '../../shared/contracts/desktop-api';

interface MessagingStoreState {
  readonly accountId: string | null;
  readonly chats: readonly ChatSummaryDto[];
  readonly selectedChatId: string | null;
  readonly messages: readonly MessageDto[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly loadAccount: (accountId: string | null) => Promise<void>;
  readonly selectChat: (chatId: string) => Promise<void>;
  readonly refresh: (change: MessagingChangeDto) => Promise<void>;
}

let requestSequence = 0;

async function loadProjection(
  accountId: string,
  preferredChatId: string | null,
): Promise<{
  readonly chats: readonly ChatSummaryDto[];
  readonly selectedChatId: string | null;
  readonly messages: readonly MessageDto[];
}> {
  const chats = await window.multiomon.messaging.listChats(accountId);
  const selectedChatId =
    chats.find(({ id }) => id === preferredChatId)?.id ?? chats.at(0)?.id ?? null;
  const messages = selectedChatId
    ? await window.multiomon.messaging.listMessages(accountId, selectedChatId)
    : [];
  return { chats, selectedChatId, messages };
}

export const useMessagingStore = create<MessagingStoreState>((set, get) => ({
  accountId: null,
  chats: [],
  selectedChatId: null,
  messages: [],
  loading: false,
  error: null,
  loadAccount: async (accountId) => {
    const request = ++requestSequence;
    if (accountId === null) {
      set({ accountId: null, chats: [], selectedChatId: null, messages: [], loading: false });
      return;
    }
    set({ accountId, chats: [], selectedChatId: null, messages: [], loading: true, error: null });
    try {
      const projection = await loadProjection(accountId, null);
      if (request !== requestSequence) return;
      set({ ...projection, loading: false, error: null });
    } catch {
      if (request !== requestSequence) return;
      set({ loading: false, error: 'Could not load the local message projection.' });
    }
  },
  selectChat: async (chatId) => {
    const { accountId } = get();
    if (accountId === null) return;
    const request = ++requestSequence;
    set({ selectedChatId: chatId, messages: [], loading: true, error: null });
    try {
      const messages = await window.multiomon.messaging.listMessages(accountId, chatId);
      if (request !== requestSequence) return;
      set({ messages, loading: false });
    } catch {
      if (request !== requestSequence) return;
      set({ loading: false, error: 'Could not load messages for this conversation.' });
    }
  },
  refresh: async (change) => {
    const state = get();
    if (state.accountId !== change.accountId) return;
    const request = ++requestSequence;
    try {
      const projection = await loadProjection(change.accountId, state.selectedChatId);
      if (request !== requestSequence) return;
      set({ ...projection, loading: false, error: null });
    } catch {
      if (request !== requestSequence) return;
      set({ error: 'Could not refresh the local message projection.' });
    }
  },
}));
