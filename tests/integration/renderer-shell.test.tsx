// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    Object.defineProperty(window, 'multiomon', {
      configurable: true,
      value: {
        ping: vi.fn().mockResolvedValue('pong'),
        getRuntimeInfo: vi.fn().mockResolvedValue({
          platform: 'darwin',
          versions: { chrome: '1', electron: '44.7.2', node: '24.0.0' },
        }),
        accounts: {
          getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
          select,
          create: vi.fn().mockResolvedValue(initialSnapshot),
          remove: vi.fn().mockResolvedValue(initialSnapshot),
          logout: vi.fn().mockResolvedValue(initialSnapshot),
          pair: vi.fn().mockResolvedValue(undefined),
          connect: vi.fn().mockResolvedValue(undefined),
          subscribe: vi.fn().mockReturnValue(vi.fn()),
        },
        messaging: {
          listChats: vi.fn((accountId: string) =>
            Promise.resolve([
              {
                id: `${accountId}-chat`,
                accountId,
                title: 'Example conversation',
                kind: 'direct' as const,
                unreadCount: 0,
                lastActivityAt: 100,
              },
            ]),
          ),
          listMessages: vi.fn((accountId: string, chatId: string) =>
            Promise.resolve([
              {
                id: `${accountId}-message`,
                accountId,
                chatId,
                direction: 'incoming' as const,
                sentAt: 100,
                content: {
                  kind: 'system' as const,
                  text: 'Mock provider projection is connected.',
                },
              },
            ]),
          ),
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
});
