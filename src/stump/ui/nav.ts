// The signed-in app's navigation, one line per area (src/stump/README.md).
// `work` holds daily work; configuration lives under `settings`. Add an entry
// only with the screen it opens.
export interface NavEntry { group: 'work' | 'settings'; to: string; label: string }

export const navigation: readonly NavEntry[] = [
  { group: 'work', to: '/app', label: 'Overview' },
  { group: 'work', to: '/app/ledger', label: 'Ledger' },
  { group: 'settings', to: '/app/settings/team', label: 'Team' },
  { group: 'settings', to: '/app/settings/publishing', label: 'Publishing' },
  { group: 'settings', to: '/app/settings/connections', label: 'Connections' },
  { group: 'settings', to: '/app/settings/agents', label: 'Agents' },
]
