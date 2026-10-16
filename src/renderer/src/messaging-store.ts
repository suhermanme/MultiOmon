import { create } from 'zustand';
import type {
  ChatPageCursorDto,
  ChatSummaryDto,
  MessageDto,
  MessagePageCursorDto,
  MessagingChangeDto,
} from '../../shared/contracts/desktop-api';

interface MessagingStoreState {
  readonly accountId: string | null;
  readonly chats: readonly ChatSummaryDto[];
  readonly chatsNextCursor: ChatPageCursorDto | null;
  readonly selectedChatId: string | null;
  readonly messages: readonly MessageDto[];
  readonly messagesNextCursor: MessagePageCursorDto | null;
  readonly messageLimit: number;
  readonly historyLoading: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly loadAccount: (accountId: string | null) => Promise<void>;
  readonly selectChat: (chatId: string) => Promise<void>;
  readonly loadMoreChats: () => Promise<void>;
  readonly loadOlderMessages: () => Promise<void>;
  readonly requestEarlierHistory: () => Promise<void>;
  readonly refresh: (changes: readonly MessagingChangeDto[]) => Promise<void>;
}

let requestSequence = 0;

interface Projection {
  readonly chats: readonly ChatSummaryDto[];
  readonly chatsNextCursor: ChatPageCursorDto | null;
  readonly selectedChatId: string | null;
  readonly messages: readonly MessageDto[];
  readonly messagesNextCursor: MessagePageCursorDto | null;
}

async function loadProjection(
  accountId: string,
  preferredChatId: string | null,
  messageLimit = 50,
): Promise<Projection> {
  const chatPage = await window.multiomon.messaging.listChats(accountId);
  const selectedChatId =
    chatPage.items.find(({ id }) => id === preferredChatId)?.id ?? chatPage.items.at(0)?.id ?? null;
  const messagePage = selectedChatId
    ? await window.multiomon.messaging.listMessages(accountId, selectedChatId, {
        limit: messageLimit,
      })
    : { items: [], nextCursor: null };
  return {
    chats: chatPage.items,
    chatsNextCursor: chatPage.nextCursor,
    selectedChatId,
    messages: messagePage.items,
    messagesNextCursor: messagePage.nextCursor,
  };
}

export const useMessagingStore = create<MessagingStoreState>((set, get) => ({
  accountId: null,
  chats: [],
  chatsNextCursor: null,
  selectedChatId: null,
  messages: [],
  messagesNextCursor: null,
  messageLimit: 50,
  historyLoading: false,
  loading: false,
  error: null,
  loadAccount: async (accountId) => {
    const request = ++requestSequence;
    if (accountId === null) {
      set({
        accountId: null,
        chats: [],
        chatsNextCursor: null,
        selectedChatId: null,
        messages: [],
        messagesNextCursor: null,
        messageLimit: 50,
        historyLoading: false,
        loading: false,
      });
      return;
    }
    set({
      accountId,
      chats: [],
      chatsNextCursor: null,
      selectedChatId: null,
      messages: [],
      messagesNextCursor: null,
      messageLimit: 50,
      historyLoading: false,
      loading: true,
      error: null,
    });
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
    set({
      selectedChatId: chatId,
      messages: [],
      messagesNextCursor: null,
      messageLimit: 50,
      historyLoading: false,
      loading: true,
      error: null,
    });
    try {
      const page = await window.multiomon.messaging.listMessages(accountId, chatId);
      if (request !== requestSequence) return;
      set({ messages: page.items, messagesNextCursor: page.nextCursor, loading: false });
    } catch {
      if (request !== requestSequence) return;
      set({ loading: false, error: 'Could not load messages for this conversation.' });
    }
  },
  loadMoreChats: async () => {
    const { accountId, chatsNextCursor, loading } = get();
    if (accountId === null || chatsNextCursor === null || loading) return;
    const request = ++requestSequence;
    set({ loading: true });
    try {
      const page = await window.multiomon.messaging.listChats(accountId, {
        cursor: chatsNextCursor,
      });
      if (request !== requestSequence) return;
      set((state) => ({
        chats: [...state.chats, ...page.items],
        chatsNextCursor: page.nextCursor,
        loading: false,
      }));
    } catch {
      if (request !== requestSequence) return;
      set({ loading: false, error: 'Could not load more conversations.' });
    }
  },
  loadOlderMessages: async () => {
    const { accountId, selectedChatId, messagesNextCursor, loading } = get();
    if (accountId === null || selectedChatId === null || messagesNextCursor === null || loading) {
      return;
    }
    const request = ++requestSequence;
    set({ loading: true });
    try {
      const page = await window.multiomon.messaging.listMessages(accountId, selectedChatId, {
        cursor: messagesNextCursor,
      });
      if (request !== requestSequence) return;
      // Pages arrive newest-first; older pages prepend to the chronological thread.
      set((state) => ({
        messages: [...page.items, ...state.messages],
        messagesNextCursor: page.nextCursor,
        messageLimit: Math.min(state.messageLimit + 50, 200),
        loading: false,
      }));
    } catch {
      if (request !== requestSequence) return;
      set({ loading: false, error: 'Could not load older messages.' });
    }
  },
  requestEarlierHistory: async () => {
    const { accountId, selectedChatId, historyLoading, messages } = get();
    if (accountId === null || selectedChatId === null || historyLoading || messages.length === 0) {
      return;
    }
    set((state) => ({
      historyLoading: true,
      messageLimit: Math.min(state.messageLimit + 50, 200),
      error: null,
    }));
    try {
      await window.multiomon.messaging.requestHistory(accountId, selectedChatId);
      set({ historyLoading: false });
    } catch {
      set({ historyLoading: false, error: 'Could not request earlier provider history.' });
    }
  },
  refresh: async (changes) => {
    const state = get();
    if (state.accountId === null) return;
    // A batch (e.g. history hydration) reloads the projection once, not per change.
    if (!changes.some((change) => change.accountId === state.accountId)) return;
    const request = ++requestSequence;
    try {
      const projection = await loadProjection(
        state.accountId,
        state.selectedChatId,
        state.messageLimit,
      );
      if (request !== requestSequence) return;
      set({ ...projection, loading: false, error: null });
    } catch {
      if (request !== requestSequence) return;
      set({ error: 'Could not refresh the local message projection.' });
    }
  },
}));
