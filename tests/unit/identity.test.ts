import { describe, expect, it } from 'vitest';
import { createAccountId, createScopedRemoteKey } from '../../src/domain';

describe('account-scoped remote identity', () => {
  it('does not collide when two accounts share a remote identifier', () => {
    const first = createScopedRemoteKey(createAccountId('first'), 'same-remote-id');
    const second = createScopedRemoteKey(createAccountId('second'), 'same-remote-id');

    expect(first).not.toBe(second);
  });

  it('rejects empty identifiers', () => {
    expect(() => createAccountId('  ')).toThrow(TypeError);
  });
});
