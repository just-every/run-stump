// The venue kinds and statuses with the words people read, and the fields
// each kind needs (STUMP-VENUE-001.1). No imports: the screens use it too.
/** text: one line; url: an http(s) address; list: a few short words (topics); date: YYYY-MM-DD. */
export type DetailType = 'text' | 'url' | 'list' | 'integer' | 'number' | 'date'
export const KIND_FIELDS = {
  subreddit: { label: 'Subreddit', url: true, details: { subreddit: 'text', flair: 'text' }, required: [] },
  forum: { label: 'Forum', url: true, details: { section: 'text' }, required: [] },
  slack: { label: 'Slack community', url: true, details: { workspace: 'text', channel: 'text' }, required: [] },
  discord: { label: 'Discord server', url: true, details: { server: 'text', channel: 'text' }, required: [] },
  newsletter: { label: 'Newsletter', url: true, details: { publisher: 'text', cadence: 'text', subscribers: 'integer', contact: 'text' }, required: [] },
  podcast: { label: 'Podcast', url: true, details: { host: 'text', cadence: 'text', guest_intake_url: 'url', topics: 'list', contact: 'text' }, required: [] },
  directory: { label: 'Directory', url: true, details: { listing_url: 'text', price_usd: 'number' }, required: [] },
  publication: { label: 'Publication', url: true, details: { section: 'text', contact: 'text' }, required: [] },
  journalist: { label: 'Journalist', url: false, details: { publication: 'text', beat: 'text', contact: 'text' }, required: ['publication'] },
  launch: { label: 'Launch platform', url: true, details: { launch_day: 'text' }, required: [] },
  event: { label: 'Event', url: true, details: { date: 'date', location: 'text' }, required: [] },
  own_channel: { label: 'Own channel', url: true, details: { network: 'text', handle: 'text' }, required: [] },
} as const satisfies Record<string, { label: string; url: boolean; details: Record<string, DetailType>; required: readonly string[] }>
export type KindId = keyof typeof KIND_FIELDS

export const STATUS_LABELS: Record<string, string> = { candidate: 'Candidate', join_first: 'Join first', ready: 'Ready', editorial: 'Editorial', paid: 'Paid', hold: 'On hold', excluded: 'Excluded' }
export const ROUTE_LABELS: Record<string, string> = { publish: 'Publish', handoff_draft: 'Hand off with draft', handoff_brief: 'Hand off with brief' }
export const DETAIL_LABELS: Record<string, string> = {
  subreddit: 'Subreddit', flair: 'Flair', section: 'Section', workspace: 'Workspace', channel: 'Channel', server: 'Server', publisher: 'Publisher', cadence: 'Cadence',
  subscribers: 'Subscribers', contact: 'Contact', host: 'Host', listing_url: 'Listing', price_usd: 'Price (USD)', publication: 'Publication', beat: 'Beat',
  launch_day: 'Launch day', guest_intake_url: 'Guest intake', topics: 'Topics', date: 'Date', location: 'Location', network: 'Network', handle: 'Handle',
}
