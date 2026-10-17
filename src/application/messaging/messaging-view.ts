import type {
  AttachmentRepository,
  ChatPageCursor,
  ChatRepository,
  MessagePageCursor,
  MessageRepository,
  ReceiptRepository,
} from '../ports/repositories';
import type {
  AccountId,
  Chat,
  ChatId,
  Message,
  MessageContent,
  Receipt,
  ReceiptStatus,
} from '../../domain';
import { createChatId, createMessageId } from '../../domain';
import type {
  ChatPageDto,
  ChatPageOptionsDto,
  ChatSummaryDto,
  MessageContentDto,
  MessageDto,
  MessagePageDto,
  MessagePageOptionsDto,
  PairingUpdateDto,
} from '../../shared/contracts/desktop-api';
import type { PairingEvent } from './messaging-service';

function toMessageContentDto(
  accountId: AccountId,
  content: MessageContent,
  attachments?: AttachmentRepository,
): MessageContentDto {
  switch (content.kind) {
    case 'text':
    case 'system':
      return content;
    case 'media': {
      const attachment = attachments?.getById(accountId, content.attachmentId);
      return {
        kind: 'media',
        attachmentId: content.attachmentId,
        attachmentKind: attachment?.kind ?? 'document',
        mediaType: attachment?.mediaType ?? 'application/octet-stream',
        ...(attachment?.fileName === undefined ? {} : { fileName: attachment.fileName }),
        ...(attachment?.sizeBytes === undefined ? {} : { sizeBytes: attachment.sizeBytes }),
        ...(content.caption === undefined ? {} : { caption: content.caption }),
      };
    }
  }
}

// The visible tick reflects the weakest recipient: a message counts as
// delivered only once every recipient acknowledged it, read once all read it.
const RECEIPT_RANK: Record<ReceiptStatus, number> = { sent: 0, delivered: 1, read: 2, played: 3 };

function aggregateReceiptStatus(receipts: readonly Receipt[]): ReceiptStatus | undefined {
  let weakest: ReceiptStatus | undefined;
  for (const receipt of receipts) {
    if (weakest === undefined || RECEIPT_RANK[receipt.status] < RECEIPT_RANK[weakest]) {
      weakest = receipt.status;
    }
  }
  return weakest;
}

function toMessageDto(
  message: Message,
  attachments?: AttachmentRepository,
  receiptStatus?: ReceiptStatus,
): MessageDto {
  return {
    id: message.id,
    accountId: message.accountId,
    chatId: message.chatId,
    direction: message.direction,
    sentAt: message.sentAt,
    content: toMessageContentDto(message.accountId, message.content, attachments),
    ...(message.senderRemoteId === undefined ? {} : { senderRemoteId: message.senderRemoteId }),
    ...(message.replyToMessageId === undefined
      ? {}
      : { replyToMessageId: message.replyToMessageId }),
    ...(receiptStatus === undefined ? {} : { receiptStatus }),
  };
}

export function toPairingUpdateDto(event: PairingEvent): PairingUpdateDto {
  if (event.type === 'pairing.code') {
    return {
      accountId: event.accountId,
      kind: 'code',
      code: event.code,
      expiresAt: event.expiresAt,
    };
  }
  return { accountId: event.accountId, kind: 'qr', payload: event.payload };
}

function toChatSummaryDto(chat: Chat): ChatSummaryDto {
  return {
    id: chat.id,
    accountId: chat.accountId,
    title: chat.title,
    kind: chat.kind,
    unreadCount: chat.unreadCount,
    ...(chat.lastActivityAt === undefined ? {} : { lastActivityAt: chat.lastActivityAt }),
  };
}

function toChatPageCursor(cursor: ChatPageCursor | null): ChatPageDto['nextCursor'] {
  return cursor ? { lastActivityAt: cursor.lastActivityAt, chatId: cursor.chatId } : null;
}

function fromChatPageOptions(options: ChatPageOptionsDto): {
  limit: number;
  cursor?: ChatPageCursor;
} {
  return {
    limit: options.limit ?? 30,
    ...(options.cursor
      ? {
          cursor: {
            lastActivityAt: options.cursor.lastActivityAt,
            chatId: createChatId(options.cursor.chatId),
          },
        }
      : {}),
  };
}

function fromMessagePageOptions(options: MessagePageOptionsDto): {
  limit: number;
  cursor?: MessagePageCursor;
} {
  return {
    limit: options.limit ?? 50,
    ...(options.cursor
      ? {
          cursor: {
            sentAt: options.cursor.sentAt,
            messageId: createMessageId(options.cursor.messageId),
          },
        }
      : {}),
  };
}
export class MessagingView {
  readonly #chats: ChatRepository;
  readonly #messages: MessageRepository;
  readonly #attachments?: AttachmentRepository;
  readonly #receipts?: ReceiptRepository;

  constructor(
    chats: ChatRepository,
    messages: MessageRepository,
    attachments?: AttachmentRepository,
    receipts?: ReceiptRepository,
  ) {
    this.#chats = chats;
    this.#messages = messages;
    this.#attachments = attachments;
    this.#receipts = receipts;
  }

  listChats(accountId: AccountId, options: ChatPageOptionsDto = {}): ChatPageDto {
    const { limit, cursor } = fromChatPageOptions(options);
    const page = this.#chats.listPage(accountId, limit, cursor);
    return {
      items: page.items.map(toChatSummaryDto),
      nextCursor: toChatPageCursor(page.nextCursor),
    };
  }

  listMessages(
    accountId: AccountId,
    chatId: ChatId,
    options: MessagePageOptionsDto = {},
  ): MessagePageDto {
    const { limit, cursor } = fromMessagePageOptions(options);
    const page = this.#messages.listPage(accountId, chatId, limit, cursor);
    return {
      items: [...page.items]
        .reverse()
        .map((message) =>
          toMessageDto(
            message,
            this.#attachments,
            message.direction === 'outgoing' && this.#receipts
              ? aggregateReceiptStatus(this.#receipts.listByMessage(message.accountId, message.id))
              : undefined,
          ),
        ),
      nextCursor: page.nextCursor
        ? { sentAt: page.nextCursor.sentAt, messageId: page.nextCursor.messageId }
        : null,
    };
  }
}
