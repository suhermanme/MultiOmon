// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/src/App';
import { useAccountStore } from '../../src/renderer/src/account-store';
import { usePairingStore } from '../../src/renderer/src/pairing-store';
import type {
  AccountSnapshotDto,
  DesktopApi,
  PairingUpdateDto,
} from '../../src/shared/contracts/desktop-api';

const idleSnapshot: AccountSnapshotDto = {
  activeAccountId: 'personal',
  accounts: [
    {
      id: 'personal',
      displayName: 'Personal',
      phoneNumber: '+33612345678',
      connectionState: { kind: 'idle', changedAt: 0 },
    },
  ],
};

describe('pairing UI', () => {
  let pairingListener: ((update: PairingUpdateDto) => void) | undefined;
  let create: DesktopApi['accounts']['create'];
  let pair: DesktopApi['accounts']['pair'];

  beforeEach(() => {
    useAccountStore.setState({
      snapshot: { accounts: [], activeAccountId: null },
      loading: true,
      error: null,
      pendingAction: null,
    });
    usePairingStore.getState().reset();
    pairingListener = undefined;

    create = vi.fn().mockResolvedValue(idleSnapshot);
    pair = vi.fn((accountId: string) => {
      // The main process pushes the QR update over the pairing channel while pair() is in flight.
      pairingListener?.({ accountId, kind: 'qr', payload: '1@abc123#def456' });
      return Promise.resolve();
    });

    Object.defineProperty(window, 'multiomon', {
      configurable: true,
      value: {
        ping: vi.fn().mockResolvedValue('pong'),
        getRuntimeInfo: vi.fn().mockResolvedValue({
          platform: 'linux',
          messagingProvider: 'mock',
          versions: { chrome: '1', electron: '44.7.2', node: '24.0.0' },
        }),
        accounts: {
          getSnapshot: vi.fn().mockResolvedValue(idleSnapshot),
          select: vi.fn((accountId: string) =>
            Promise.resolve({ ...idleSnapshot, activeAccountId: accountId }),
          ),
          create,
          remove: vi.fn().mockResolvedValue(idleSnapshot),
          logout: vi.fn().mockResolvedValue(idleSnapshot),
          pair,
          connect: vi.fn().mockResolvedValue(undefined),
          subscribe: vi.fn().mockReturnValue(vi.fn()),
        },
        messaging: {
          listChats: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
          listMessages: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
          requestHistory: vi.fn().mockResolvedValue(undefined),
          downloadMedia: vi.fn().mockRejectedValue(new Error('No fixture media')),
          subscribe: vi.fn().mockReturnValue(vi.fn()),
        },
        pairing: {
          subscribe: vi.fn((listener: (update: PairingUpdateDto) => void) => {
            pairingListener = listener;
            return () => {
              pairingListener = undefined;
            };
          }),
        },
      } satisfies DesktopApi,
    });
  });

  afterEach(() => cleanup());

  it('creates an account from the add-account form', async () => {
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Personal' })).toBeVisible());

    expect(screen.queryByRole('dialog', { name: 'Add an account' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));

    expect(screen.getByRole('dialog', { name: 'Add an account' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Work' } });
    fireEvent.change(screen.getByLabelText(/Phone number/), {
      target: { value: '+447700900123' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add account' }).at(-1)!);

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ displayName: 'Work', phoneNumber: '+447700900123' }),
    );
    expect(screen.queryByRole('dialog', { name: 'Add an account' })).toBeNull();
  });

  it('dismisses the add-account dialog without creating an account', async () => {
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Personal' })).toBeVisible());

    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Add an account' })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('starts pairing and renders the QR update pushed through the bridge', async () => {
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pair' })).toBeEnabled());
    const pairButton = screen.getByRole('button', { name: 'Pair' });

    fireEvent.click(pairButton);
    // The panel is committed synchronously; QR rasterization is still pending at this point.
    expect(screen.getByText('Preparing QR code…')).toBeVisible();
    await waitFor(() => expect(pair).toHaveBeenCalledWith('personal'));

    const qr = await screen.findByAltText('Pairing QR code');
    expect(qr.getAttribute('src')).toContain('data:image/svg+xml;base64,');
  });

  it('renders a pairing code update and hides the panel when cleared', async () => {
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Personal' })).toBeVisible());

    act(() => {
      pairingListener?.({
        accountId: 'personal',
        kind: 'code',
        code: 'ABCD1234',
        expiresAt: Date.now() + 60_000,
      });
    });
    expect(screen.getByLabelText('Pairing for Personal')).toBeInTheDocument();
    expect(screen.getByText('ABCD1234')).toBeVisible();

    act(() => {
      pairingListener?.({ accountId: 'personal', kind: 'cleared' });
    });
    expect(screen.queryByLabelText('Pairing for Personal')).not.toBeInTheDocument();
  });
});
