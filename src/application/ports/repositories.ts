import type {
  Account,
  AccountId,
  Chat,
  ChatId,
  Contact,
  ContactId,
  Message,
  MessageId,
} from '../../domain';

export interface MessagePageCursor {
  readonly sentAt: number;
  readonly messageId: MessageId;
}

export interface Page<T, TCursor> {
  readonly items: readonly T[];
  readonly nextCursor: TCursor | null;
}

export interface AccountRepository {
  save(account: Account): void;
  getById(accountId: AccountId): Account | null;
  list(): readonly Account[];
  delete(accountId: AccountId): void;
}

export interface ChatRepository {
  save(chat: Chat): void;
  getById(accountId: AccountId, chatId: ChatId): Chat | null;
  getByRemoteId(accountId: AccountId, remoteId: string): Chat | null;
  listByAccount(accountId: AccountId): readonly Chat[];
}

export interface ContactRepository {
  save(contact: Contact): void;
  getById(accountId: AccountId, contactId: ContactId): Contact | null;
  getByRemoteId(accountId: AccountId, remoteId: string): Contact | null;
  listByAccount(accountId: AccountId): readonly Contact[];
}

export interface MessageRepository {
  insert(message: Message): boolean;
  getById(accountId: AccountId, messageId: MessageId): Message | null;
  getByRemoteId(accountId: AccountId, remoteId: string): Message | null;
  listPage(
    accountId: AccountId,
    chatId: ChatId,
    limit: number,
    cursor?: MessagePageCursor,
  ): Page<Message, MessagePageCursor>;
}

export interface RepositoryBundle {
  readonly accounts: AccountRepository;
  readonly chats: ChatRepository;
  readonly contacts: ContactRepository;
  readonly messages: MessageRepository;
}

export interface TransactionRunner {
  runInTransaction<T>(work: () => T): T;
}
