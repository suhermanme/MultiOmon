import type { AccountId, ContactId } from './identity';

export interface Contact {
  readonly id: ContactId;
  readonly accountId: AccountId;
  readonly remoteId: string;
  readonly displayName: string;
  readonly phoneNumber?: string;
  readonly avatarUrl?: string;
}
