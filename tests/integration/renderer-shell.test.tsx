// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/src/App';

describe('renderer shell', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'multiomon', {
      configurable: true,
      value: {
        ping: vi.fn().mockResolvedValue('pong'),
        getRuntimeInfo: vi.fn().mockResolvedValue({
          platform: 'darwin',
          versions: { chrome: '1', electron: '38.0.0', node: '22.0.0' },
        }),
      },
    });
  });

  it('uses the typed bridge to report readiness', async () => {
    render(createElement(App));

    expect(screen.getByRole('heading', { name: 'MultiOmon' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Secure desktop bridge ready')).toBeVisible());
    expect(screen.getByText('darwin · Electron 38.0.0')).toBeVisible();
  });
});
