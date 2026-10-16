import type {
  ChatPageCursor,
  ChatRepository,
  MessagePageCursor,
  MessageRepository,
} from '../ports/repositories';
import type { AccountId, Chat, ChatId, Message, MessageContent } from '../../domain';
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

function toMessageContentDto(content: MessageContent): MessageContentDto {
  switch (content.kind) {
    case 'text':
    case 'system':
      return content;
    case 'media':
      return {
        kind: 'media',
        attachmentId: content.attachmentId,
        ...(content.caption === undefined ? {} : { caption: content.caption }),
      };
  }
}

function toMessageDto(message: Message): MessageDto {
  return {
    id: message.id,
    accountId: message.accountId,
    chatId: message.chatId,
    direction: message.direction,
    sentAt: message.sentAt,
    content: toMessageContentDto(message.content),
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

  constructor(chats: ChatRepository, messages: MessageRepository) {
    this.#chats = chats;
    this.#messages = messages;
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
      items: [...page.items].reverse().map(toMessageDto),
      nextCursor: page.nextCursor
        ? { sentAt: page.nextCursor.sentAt, messageId: page.nextCursor.messageId }
        : null,
    };
  }
}
