import type { AccountId, ChatId } from './identity';

export interface Chat {
  readonly id: ChatId;
  readonly accountId: AccountId;
  readonly remoteId: string;
  readonly kind: 'direct' | 'group';
  readonly title: string;
  readonly unreadCount: number;
  readonly lastActivityAt?: number;
}
