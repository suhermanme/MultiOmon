import type Database from 'better-sqlite3';
import { DatabaseError, withDatabaseError } from './database-error';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'create_core_projection',
    sql: `
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE contacts (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        remote_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        phone_number TEXT,
        avatar_url TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, id),
        UNIQUE (account_id, remote_id),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE chats (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        remote_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
        title TEXT NOT NULL,
        unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
        last_activity_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, id),
        UNIQUE (account_id, remote_id),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE messages (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        remote_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
        sender_remote_id TEXT,
        sent_at INTEGER NOT NULL,
        content_kind TEXT NOT NULL CHECK (content_kind IN ('text', 'media', 'system')),
        text_content TEXT,
        attachment_id TEXT,
        caption TEXT,
        reply_to_message_id TEXT,
        edited_at INTEGER,
        deleted_at INTEGER,
        PRIMARY KEY (account_id, id),
        UNIQUE (account_id, remote_id),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id, chat_id) REFERENCES chats(account_id, id) ON DELETE CASCADE
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: 'add_projection_indexes',
    sql: `
      CREATE INDEX contacts_by_account_name
        ON contacts(account_id, display_name COLLATE NOCASE, id);
      CREATE INDEX chats_by_account_activity
        ON chats(account_id, last_activity_at DESC, id DESC);
      CREATE INDEX messages_by_chat_page
        ON messages(account_id, chat_id, sent_at DESC, id DESC);
    `,
  },
  {
    version: 3,
    name: 'add_account_phone_number',
    sql: `
      ALTER TABLE accounts ADD COLUMN phone_number TEXT;
    `,
  },
  {
    version: 4,
    name: 'rebuild_chat_page_index',
    sql: `
      DROP INDEX chats_by_account_activity;
      CREATE INDEX chats_by_account_activity
        ON chats(account_id, COALESCE(last_activity_at, 0) DESC, id DESC);
    `,
  },
];

interface MigrationRow {
  readonly version: number;
}

export function runMigrations(database: Database.Database): void {
  withDatabaseError('run migrations', () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `);

    const appliedRows = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as MigrationRow[];
    const applied = new Set(appliedRows.map(({ version }) => version));
    const latestKnownVersion = migrations.at(-1)?.version ?? 0;
    const newestAppliedVersion = appliedRows.at(-1)?.version ?? 0;

    if (newestAppliedVersion > latestKnownVersion) {
      throw new DatabaseError(
        'validate migration version',
        new Error(`Database version ${newestAppliedVersion} is newer than ${latestKnownVersion}`),
      );
    }

    const insertMigration = database.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      database.transaction(() => {
        database.exec(migration.sql);
        insertMigration.run(migration.version, migration.name, Date.now());
      })();
    }
  });
}

export function getAppliedMigrationVersions(database: Database.Database): readonly number[] {
  return withDatabaseError('list migration versions', () =>
    (
      database
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as MigrationRow[]
    ).map(({ version }) => version),
  );
}
