import type { AccountId, MessageId } from './identity';

export interface Reaction {
  readonly accountId: AccountId;
  readonly messageId: MessageId;
  readonly actorRemoteId: string;
  readonly emoji: string;
  readonly reactedAt: number;
}

export type ReceiptStatus = 'sent' | 'delivered' | 'read' | 'played';

export interface Receipt {
  readonly accountId: AccountId;
  readonly messageId: MessageId;
  readonly recipientRemoteId: string;
  readonly status: ReceiptStatus;
  readonly occurredAt: number;
}
