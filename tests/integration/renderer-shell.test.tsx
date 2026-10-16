// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { App } from '../../src/renderer/src/App';
import { useAccountStore } from '../../src/renderer/src/account-store';
import type { AccountSnapshotDto, DesktopApi } from '../../src/shared/contracts/desktop-api';

const initialSnapshot: AccountSnapshotDto = {
  activeAccountId: 'personal',
  accounts: [
    {
      id: 'personal',
      displayName: 'Personal',
      connectionState: { kind: 'connected', changedAt: 0, connectedAt: 0 },
    },
    {
      id: 'work',
      displayName: 'Work',
      connectionState: { kind: 'connected', changedAt: 0, connectedAt: 0 },
    },
    {
      id: 'community',
      displayName: 'Community',
      connectionState: { kind: 'connected', changedAt: 0, connectedAt: 0 },
    },
  ],
};

describe('renderer shell', () => {
  let select: DesktopApi['accounts']['select'];
  let getSnapshot: Mock<DesktopApi['accounts']['getSnapshot']>;
  let listChats: Mock<DesktopApi['messaging']['listChats']>;
  let listMessages: Mock<DesktopApi['messaging']['listMessages']>;

  beforeEach(() => {
    useAccountStore.setState({
      snapshot: { accounts: [], activeAccountId: null },
      loading: true,
      error: null,
    });

    select = vi.fn((accountId: string) =>
      Promise.resolve({
        ...initialSnapshot,
        activeAccountId: accountId,
      }),
    );

    getSnapshot = vi.fn<DesktopApi['accounts']['getSnapshot']>(() =>
      Promise.resolve(initialSnapshot),
    );
    listChats = vi.fn<DesktopApi['messaging']['listChats']>((accountId) =>
      Promise.resolve({
        items: [
          {
            id: `${accountId}-chat`,
            accountId,
            title: 'Example conversation',
            kind: 'direct',
            unreadCount: 0,
            lastActivityAt: 100,
          },
        ],
        nextCursor: null,
      }),
    );
    listMessages = vi.fn<DesktopApi['messaging']['listMessages']>((accountId, chatId) =>
      Promise.resolve({
        items: [
          {
            id: `${accountId}-message`,
            accountId,
            chatId,
            direction: 'incoming',
            sentAt: 100,
            content: {
              kind: 'system',
              text: 'Mock provider projection is connected.',
            },
          },
        ],
        nextCursor: null,
      }),
    );

    Object.defineProperty(window, 'multiomon', {
      configurable: true,
      value: {
        ping: vi.fn().mockResolvedValue('pong'),
        getRuntimeInfo: vi.fn().mockResolvedValue({
          platform: 'darwin',
          versions: { chrome: '1', electron: '44.7.2', node: '24.0.0' },
        }),
        accounts: {
          getSnapshot,
          select,
          create: vi.fn().mockResolvedValue(initialSnapshot),
          remove: vi.fn().mockResolvedValue(initialSnapshot),
          logout: vi.fn().mockResolvedValue(initialSnapshot),
          pair: vi.fn().mockResolvedValue(undefined),
          connect: vi.fn().mockResolvedValue(undefined),
          subscribe: vi.fn().mockReturnValue(vi.fn()),
        },
        messaging: {
          listChats,
          listMessages,
          subscribe: vi.fn().mockReturnValue(vi.fn()),
        },
        pairing: {
          subscribe: vi.fn().mockReturnValue(vi.fn()),
        },
      } satisfies DesktopApi,
    });
  });

  afterEach(() => cleanup());

  it('renders three simultaneously connected mock accounts', async () => {
    render(createElement(App));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Personal' })).toBeVisible());
    expect(
      screen.getByRole('button', { name: /Switch to Personal account, Connected/ }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /Switch to Work account, Connected/ })).toBeVisible();
    expect(
      screen.getByRole('button', { name: /Switch to Community account, Connected/ }),
    ).toBeVisible();
    expect(screen.getByText('Desktop ready')).toBeVisible();
    expect(screen.getByRole('button', { name: /Example conversation/ })).toBeVisible();
    expect(await screen.findByText('Mock provider projection is connected.')).toBeVisible();
  });

  it('switches active account without changing connection indicators', async () => {
    render(createElement(App));
    const workButton = await screen.findByRole('button', {
      name: /Switch to Work account, Connected/,
    });

    fireEvent.click(workButton);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Work' })).toBeVisible());
    expect(select).toHaveBeenCalledWith('work');
    expect(workButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { name: /Connected/ })).toHaveLength(3);
  });

  it('filters loaded conversations through the search field', async () => {
    listChats.mockResolvedValue({
      items: [
        {
          id: 'personal-chat',
          accountId: 'personal',
          title: 'Example conversation',
          kind: 'direct',
          unreadCount: 0,
          lastActivityAt: 100,
        },
        {
          id: 'personal-zebra',
          accountId: 'personal',
          title: 'Zebra chat',
          kind: 'direct',
          unreadCount: 2,
          lastActivityAt: 90,
        },
      ],
      nextCursor: null,
    });
    render(createElement(App));

    const zebra = await screen.findByRole('button', { name: /Zebra chat/ });
    expect(zebra).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /Example conversation/ })).toBeVisible();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search conversations' }), {
      target: { value: 'zebra' },
    });
    expect(screen.queryByRole('button', { name: /Example conversation/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Zebra chat/ })).toBeVisible();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search conversations' }), {
      target: { value: 'unmatched' },
    });
    expect(screen.getByText('No matching conversations')).toBeVisible();
    expect(
      screen.getByText('Search filters the conversations already loaded locally.'),
    ).toBeVisible();
  });

  it('appends the next conversation page when loading more', async () => {
    listChats
      .mockResolvedValueOnce({
        items: [
          {
            id: 'personal-chat',
            accountId: 'personal',
            title: 'Example conversation',
            kind: 'direct',
            unreadCount: 0,
            lastActivityAt: 100,
          },
        ],
        nextCursor: { lastActivityAt: 100, chatId: 'personal-chat' },
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'personal-second',
            accountId: 'personal',
            title: 'Second conversation',
            kind: 'group',
            unreadCount: 0,
            lastActivityAt: 50,
          },
        ],
        nextCursor: null,
      });
    render(createElement(App));

    const loadMore = await screen.findByRole('button', { name: 'Load more conversations' });
    fireEvent.click(loadMore);

    expect(await screen.findByRole('button', { name: /Second conversation/ })).toBeVisible();
    expect(listChats).toHaveBeenLastCalledWith('personal', {
      cursor: { lastActivityAt: 100, chatId: 'personal-chat' },
    });
    expect(screen.queryByRole('button', { name: 'Load more conversations' })).toBeNull();
  });

  it('prepends older message pages for the selected conversation', async () => {
    listMessages
      .mockResolvedValueOnce({
        items: [
          {
            id: 'personal-message',
            accountId: 'personal',
            chatId: 'personal-chat',
            direction: 'incoming',
            sentAt: 100,
            content: { kind: 'system', text: 'Mock provider projection is connected.' },
          },
        ],
        nextCursor: { sentAt: 100, messageId: 'personal-message' },
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'personal-message-old',
            accountId: 'personal',
            chatId: 'personal-chat',
            direction: 'outgoing',
            sentAt: 50,
            content: { kind: 'text', text: 'Older message' },
          },
        ],
        nextCursor: null,
      });
    render(createElement(App));

    const loadOlder = await screen.findByRole('button', { name: 'Load older messages' });
    fireEvent.click(loadOlder);

    expect(await screen.findByText('Older message')).toBeVisible();
    expect(listMessages).toHaveBeenLastCalledWith('personal', 'personal-chat', {
      cursor: { sentAt: 100, messageId: 'personal-message' },
    });
    const messageList = screen.getByLabelText('Messages in Example conversation');
    expect(messageList.textContent?.indexOf('Older message')).toBeLessThan(
      messageList.textContent?.indexOf('Mock provider') ?? -1,
    );
    expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull();
  });

  it('surfaces the connecting attempt and account-aware empty states', async () => {
    getSnapshot.mockResolvedValue({
      activeAccountId: 'personal',
      accounts: [
        {
          id: 'personal',
          displayName: 'Personal',
          connectionState: { kind: 'connecting', changedAt: 0, attempt: 2 },
        },
      ],
    } satisfies AccountSnapshotDto);
    listChats.mockResolvedValue({ items: [], nextCursor: null });
    render(createElement(App));

    expect(await screen.findByText('Connecting · attempt 2')).toBeVisible();
    expect(screen.getByText('Syncing conversations…')).toBeVisible();
    expect(
      screen.getByText('Message history is being downloaded and stored locally.'),
    ).toBeVisible();

    cleanup();
    getSnapshot.mockResolvedValue({
      activeAccountId: 'personal',
      accounts: [
        {
          id: 'personal',
          displayName: 'Personal',
          connectionState: { kind: 'needsPairing', changedAt: 0 },
        },
      ],
    } satisfies AccountSnapshotDto);
    render(createElement(App));

    expect(await screen.findByText('Pairing required')).toBeVisible();
    expect(
      screen.getByText('Scan the pairing code with WhatsApp to sync this account.'),
    ).toBeVisible();
  });
});
