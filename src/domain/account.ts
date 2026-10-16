import type { AccountId } from './identity';

export interface Account {
  readonly id: AccountId;
  readonly displayName: string;
  readonly createdAt: number;
  readonly avatarUrl?: string;
  readonly phoneNumber?: string;
}

export type AccountConnectionState =
  | { readonly kind: 'idle'; readonly changedAt: number }
  | { readonly kind: 'needsPairing'; readonly changedAt: number }
  | { readonly kind: 'connecting'; readonly changedAt: number; readonly attempt: number }
  | { readonly kind: 'connected'; readonly changedAt: number; readonly connectedAt: number }
  | { readonly kind: 'disconnected'; readonly changedAt: number; readonly reason?: string }
  | {
      readonly kind: 'failed';
      readonly changedAt: number;
      readonly errorCode: string;
      readonly message: string;
    };

export type AccountConnectionStateKind = AccountConnectionState['kind'];

const allowedTransitions: Readonly<
  Record<AccountConnectionStateKind, readonly AccountConnectionStateKind[]>
> = {
  idle: ['needsPairing', 'connecting', 'disconnected'],
  needsPairing: ['connecting', 'disconnected', 'failed'],
  connecting: ['connected', 'disconnected', 'failed'],
  connected: ['disconnected', 'failed'],
  disconnected: ['needsPairing', 'connecting'],
  failed: ['needsPairing', 'connecting', 'disconnected'],
};

export class InvalidConnectionTransitionError extends Error {
  readonly from: AccountConnectionStateKind;
  readonly to: AccountConnectionStateKind;

  constructor(from: AccountConnectionStateKind, to: AccountConnectionStateKind) {
    super(`Invalid account connection transition: ${from} -> ${to}`);
    this.name = 'InvalidConnectionTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransitionConnection(
  from: AccountConnectionStateKind,
  to: AccountConnectionStateKind,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function transitionConnectionState(
  current: AccountConnectionState,
  next: AccountConnectionState,
): AccountConnectionState {
  if (!canTransitionConnection(current.kind, next.kind)) {
    throw new InvalidConnectionTransitionError(current.kind, next.kind);
  }
  return next;
}
