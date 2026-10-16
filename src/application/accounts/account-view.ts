import type { AccountManagerSnapshot } from './account-manager';
import type { AccountSnapshotDto } from '../../shared/contracts/desktop-api';

export function toAccountSnapshotDto(snapshot: AccountManagerSnapshot): AccountSnapshotDto {
  return {
    activeAccountId: snapshot.activeAccountId,
    accounts: snapshot.accounts.map(({ account, connectionState }) => ({
      id: account.id,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      phoneNumber: account.phoneNumber,
      connectionState,
    })),
  };
}
