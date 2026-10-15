export class DatabaseError extends Error {
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    super(`Database operation failed: ${operation}`, { cause });
    this.name = 'DatabaseError';
    this.operation = operation;
  }
}

export function withDatabaseError<T>(operation: string, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(operation, error);
  }
}
