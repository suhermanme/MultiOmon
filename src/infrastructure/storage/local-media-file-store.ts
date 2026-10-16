import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MediaFileStore } from '../../application/ports/media-file-store';
import type { AccountId, AttachmentId } from '../../domain';

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'media';
}

function safeExtension(fileName: string | undefined): string {
  if (!fileName) return '';
  const extension = path.extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}

export class LocalMediaFileStore implements MediaFileStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = path.resolve(root);
  }

  save(
    accountId: AccountId,
    attachmentId: AttachmentId,
    fileName: string | undefined,
    bytes: Uint8Array,
  ): string {
    const directory = path.join(this.#root, safeSegment(accountId));
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(
      directory,
      `${safeSegment(attachmentId)}${safeExtension(fileName)}`,
    );
    fs.writeFileSync(destination, bytes, { mode: 0o600 });
    return destination;
  }

  read(localPath: string): Uint8Array {
    const resolved = path.resolve(localPath);
    const relative = path.relative(this.#root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Media path is outside the application media directory');
    }
    return fs.readFileSync(resolved);
  }

  removeAccount(accountId: AccountId): void {
    fs.rmSync(path.join(this.#root, safeSegment(accountId)), { recursive: true, force: true });
  }
}
