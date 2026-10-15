import type { AccountId, AttachmentId, MessageId } from './identity';

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface Attachment {
  readonly id: AttachmentId;
  readonly accountId: AccountId;
  readonly messageId: MessageId;
  readonly kind: AttachmentKind;
  readonly mediaType: string;
  readonly fileName?: string;
  readonly sizeBytes?: number;
  readonly localPath?: string;
  readonly remoteReference?: string;
}
