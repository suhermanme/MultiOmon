import type { RepositoryBundle } from '../../application/ports/repositories';
import { SqliteAccountRepository } from './account-repository';
import { SqliteAttachmentRepository } from './attachment-repository';
import { SqliteChatRepository } from './chat-repository';
import { SqliteContactRepository } from './contact-repository';
import type { SqliteDatabase } from './database';
import { SqliteMessageRepository } from './message-repository';
import { SqliteReceiptRepository } from './receipt-repository';

export function createRepositories(database: SqliteDatabase): RepositoryBundle {
  return {
    accounts: new SqliteAccountRepository(database.connection),
    attachments: new SqliteAttachmentRepository(database.connection),
    chats: new SqliteChatRepository(database.connection),
    contacts: new SqliteContactRepository(database.connection),
    messages: new SqliteMessageRepository(database.connection),
    receipts: new SqliteReceiptRepository(database.connection),
  };
}
