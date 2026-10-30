// The plain words a person reads for the ledger's networks, routes and states.
const NETWORKS: Record<string, string> = { bluesky: 'Bluesky', mastodon: 'Mastodon', x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit', hn: 'Hacker News', threads: 'Threads' }
export const networkName = (network: string | null) => network ? NETWORKS[network.toLowerCase()] ?? network : ''
export const NETWORK_OPTIONS = ['bluesky', 'mastodon', 'x', 'linkedin', 'reddit', 'hn', 'threads'] as const
export const ROUTE_WORDS: Record<string, string> = { published: 'Published', handed_off: 'Handed off', orbit: 'Sent to Orbit', mango: 'Sent to Mango' }
export const STATE_WORDS: Record<string, string> = { posted: 'Posted', failed: 'Failed', uncertain: 'Uncertain', deleted: 'Deleted', removed: 'Removed' }
