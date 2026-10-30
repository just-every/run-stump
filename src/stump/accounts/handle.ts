// An account's handle is stored as its network names it; people read it with
// the '@' each network shows (a LinkedIn member is named, not handled).

export const shownHandle = (account: { network: string; handle: string }) =>
  account.network === 'linkedin' ? account.handle : `@${account.handle.replace(/^@/, '')}`
