// The signed-in app's navigation, one line per area (src/stump/README.md).
// `work` holds daily work; configuration lives under `settings`. Add an entry
// only with the screen it opens. The sidebar picks each entry's icon from its
// path (ui/icons.tsx navIcon); settings entries show as tabs under Settings.
export interface NavEntry { group: 'work' | 'settings'; to: string; label: string }

export const navigation: readonly NavEntry[] = [
  { group: 'work', to: '/app', label: 'Overview' },
  { group: 'work', to: '/app/compose', label: 'Compose' },
  { group: 'work', to: '/app/venues', label: 'Venues' },
  { group: 'work', to: '/app/listening', label: 'Listening' },
  { group: 'work', to: '/app/inbox', label: 'Inbox' },
  { group: 'work', to: '/app/ledger', label: 'Ledger' },
  { group: 'settings', to: '/app/settings/brand', label: 'Brand' },
  { group: 'settings', to: '/app/settings/team', label: 'Team' },
  { group: 'settings', to: '/app/settings/accounts', label: 'Accounts' },
  { group: 'settings', to: '/app/settings/publishing', label: 'Publishing' },
  { group: 'settings', to: '/app/settings/connections', label: 'Connections' },
  { group: 'settings', to: '/app/pause', label: 'Pause' },
  { group: 'settings', to: '/app/settings/agents', label: 'Agents' },
]
