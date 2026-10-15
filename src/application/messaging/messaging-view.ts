import type { ChatRepository, MessageRepository } from '../ports/repositories';
import type { AccountId, ChatId, Message, MessageContent } from '../../domain';
import type {
  ChatSummaryDto,
  MessageContentDto,
  MessageDto,
} from '../../shared/contracts/desktop-api';

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

export class MessagingView {
  readonly #chats: ChatRepository;
  readonly #messages: MessageRepository;

  constructor(chats: ChatRepository, messages: MessageRepository) {
    this.#chats = chats;
    this.#messages = messages;
  }

  listChats(accountId: AccountId): readonly ChatSummaryDto[] {
    return this.#chats.listByAccount(accountId).map((chat) => ({
      id: chat.id,
      accountId: chat.accountId,
      title: chat.title,
      kind: chat.kind,
      unreadCount: chat.unreadCount,
      ...(chat.lastActivityAt === undefined ? {} : { lastActivityAt: chat.lastActivityAt }),
    }));
  }

  listMessages(accountId: AccountId, chatId: ChatId, limit = 50): readonly MessageDto[] {
    return [...this.#messages.listPage(accountId, chatId, limit).items].reverse().map(toMessageDto);
  }
}
