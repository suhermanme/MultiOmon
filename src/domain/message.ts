import type { AccountId, AttachmentId, ChatId, MessageId } from './identity';

export type MessageContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'media'; readonly attachmentId: AttachmentId; readonly caption?: string }
  | { readonly kind: 'system'; readonly text: string };

export interface Message {
  readonly id: MessageId;
  readonly accountId: AccountId;
  readonly chatId: ChatId;
  readonly remoteId: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly senderRemoteId?: string;
  readonly sentAt: number;
  readonly content: MessageContent;
  readonly replyToMessageId?: MessageId;
  readonly editedAt?: number;
  readonly deletedAt?: number;
}
