// The watches doors' answers, as the Listening screen reads them (src/stump/tools/watches.ts, findings.ts).
export interface ShownError { at: string; kind: string; message: string; source?: string; status?: number; retry_at?: string }
export interface WatchSourceView {
  kind: 'hn' | 'rss' | 'bluesky' | 'mastodon'; key: string; story_types?: string[]; url?: string; instance?: string; hashtags?: string[]; lang?: string
  backfilled_at: string | null; last_polled_at: string | null; next_poll_at: string | null; last_error: ShownError | null
}
export interface WatchView {
  id: string; name: string; product_ids: string[]
  terms: { all?: string[]; any?: string[]; none?: string[] }
  sources: WatchSourceView[]
  alerts: { immediate_min_relevance: number; slack: { configured: boolean; host: string; last_error: ShownError | null } | null; webhook: { configured: boolean; host: string; secret_set: boolean; last_error: ShownError | null } | null } | null
  interval_minutes: number; muted: boolean; muted_until: string | null
  last_error: ShownError | null; next_poll_at: string | null
  findings: { total: number; backfill: number }
  revision: number
}
export interface FindingView {
  id: string; watch_id: string; source: string; kind: string | null; url: string; title: string; text: string; author: string; points: number | null
  published_at: string | null; relevance: number; reasons: string[]; answerable: boolean
  /** Its terms are only deep in a thread about something else: a passing mention, not a thread worth answering. */
  passing: boolean
  /** Short passages of its text around the terms it matched (or its opening, when only the title matched). */
  excerpts: string[]
  reason_details: Array<{ factor: string; label: string; points: number; max: number }>
  routes: Array<'publish' | 'handoff_draft' | 'handoff_brief' | 'dismiss'>; venue: { id: string; name: string } | null
  transcript_match: { terms: string[]; excerpts: string[] } | null
  backfill: boolean; mentions: Array<{ kind: 'product' | 'competitor'; product: string; matched: string }>
  /** The thread a comment or reply sits in, when it is not the finding itself. */
  thread_url: string | null
}
export interface BlockedAuthor { handle: string; source: WatchSourceView['kind'] | null }
export interface WatchList { items: WatchView[]; total: number; blocked_authors: BlockedAuthor[] }
export interface FindingList { watch: { id: string; name: string }; items: FindingView[]; total: number }
export interface PollView { added: number; alerts_sent: number; sources: Array<{ source: string; status: string; added: number; dropped?: Partial<Record<'erased' | 'filter' | 'team' | 'blocked' | 'terms' | 'duplicate', number>>; error?: ShownError }> }
