import { describe, expect, it } from 'vitest';
import {
  InvalidConnectionTransitionError,
  canTransitionConnection,
  transitionConnectionState,
  type AccountConnectionState,
} from '../../src/domain';

describe('account connection state', () => {
  it('allows the normal connect and disconnect lifecycle', () => {
    expect(canTransitionConnection('idle', 'connecting')).toBe(true);
    expect(canTransitionConnection('connecting', 'connected')).toBe(true);
    expect(canTransitionConnection('connected', 'disconnected')).toBe(true);
    expect(canTransitionConnection('disconnected', 'connecting')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const connected: AccountConnectionState = {
      kind: 'connected',
      changedAt: 10,
      connectedAt: 10,
    };
    const connecting: AccountConnectionState = { kind: 'connecting', changedAt: 11, attempt: 2 };

    expect(() => transitionConnectionState(connected, connecting)).toThrow(
      InvalidConnectionTransitionError,
    );
  });
});
