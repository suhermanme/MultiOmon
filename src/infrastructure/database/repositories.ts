import type { RepositoryBundle } from '../../application/ports/repositories';
import { SqliteAccountRepository } from './account-repository';
import { SqliteChatRepository } from './chat-repository';
import { SqliteContactRepository } from './contact-repository';
import type { SqliteDatabase } from './database';
import { SqliteMessageRepository } from './message-repository';

export function createRepositories(database: SqliteDatabase): RepositoryBundle {
  return {
    accounts: new SqliteAccountRepository(database.connection),
    chats: new SqliteChatRepository(database.connection),
    contacts: new SqliteContactRepository(database.connection),
    messages: new SqliteMessageRepository(database.connection),
  };
}
