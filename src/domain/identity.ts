declare const accountIdBrand: unique symbol;
declare const attachmentIdBrand: unique symbol;
declare const chatIdBrand: unique symbol;
declare const contactIdBrand: unique symbol;
declare const messageIdBrand: unique symbol;

export type AccountId = string & { readonly [accountIdBrand]: 'AccountId' };
export type AttachmentId = string & { readonly [attachmentIdBrand]: 'AttachmentId' };
export type ChatId = string & { readonly [chatIdBrand]: 'ChatId' };
export type ContactId = string & { readonly [contactIdBrand]: 'ContactId' };
export type MessageId = string & { readonly [messageIdBrand]: 'MessageId' };

function createIdentifier<T extends string>(value: string, label: string): T {
  if (value.trim().length === 0) throw new TypeError(`${label} cannot be empty`);
  return value as T;
}

export const createAccountId = (value: string): AccountId =>
  createIdentifier<AccountId>(value, 'Account ID');
export const createAttachmentId = (value: string): AttachmentId =>
  createIdentifier<AttachmentId>(value, 'Attachment ID');
export const createChatId = (value: string): ChatId => createIdentifier<ChatId>(value, 'Chat ID');
export const createContactId = (value: string): ContactId =>
  createIdentifier<ContactId>(value, 'Contact ID');
export const createMessageId = (value: string): MessageId =>
  createIdentifier<MessageId>(value, 'Message ID');

export function createScopedRemoteKey(accountId: AccountId, remoteId: string): string {
  if (remoteId.trim().length === 0) throw new TypeError('Remote ID cannot be empty');
  return `${accountId.length}:${accountId}${remoteId}`;
}
