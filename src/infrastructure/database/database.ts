import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import type { TransactionRunner } from '../../application/ports/repositories';
import { withDatabaseError } from './database-error';
import { runMigrations } from './migrations';

export class SqliteDatabase implements TransactionRunner {
  readonly connection: BetterSqlite3.Database;

  private constructor(connection: BetterSqlite3.Database) {
    this.connection = connection;
  }

  static open(filePath: string): SqliteDatabase {
    return withDatabaseError('open database', () => {
      if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
      const connection = new BetterSqlite3(filePath);
      connection.pragma('foreign_keys = ON');
      connection.pragma('busy_timeout = 5000');
      if (filePath !== ':memory:') connection.pragma('journal_mode = WAL');
      runMigrations(connection);
      return new SqliteDatabase(connection);
    });
  }

  runInTransaction<T>(work: () => T): T {
    return withDatabaseError('transaction', () => this.connection.transaction(work)());
  }

  close(): void {
    withDatabaseError('close database', () => this.connection.close());
  }
}
