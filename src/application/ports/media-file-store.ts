import type { AccountId, AttachmentId } from '../../domain';

export interface MediaFileStore {
  save(
    accountId: AccountId,
    attachmentId: AttachmentId,
    fileName: string | undefined,
    bytes: Uint8Array,
  ): string;
  read(localPath: string): Uint8Array;
  removeAccount(accountId: AccountId): void;
}
