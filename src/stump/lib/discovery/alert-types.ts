import type { SourceKind } from './types.ts'

/** One finding as an alert shows it. `url` is the finding's page in the app: every alert links to its finding (STUMP-WATCH-004). */
export interface AlertFinding {
  id?: string
  title: string
  url: string
  /** The finding's own address on its source (HN item, feed item, post). */
  source_url: string
  source: SourceKind
  author: string
  published_at?: string
  relevance?: number
  reasons?: string[]
  excerpt?: string
}

export interface AlertMessage {
  kind: 'immediate' | 'digest'
  watch_name: string
  /** The watch's page in the app. */
  watch_url?: string
  findings: AlertFinding[]
  /** ISO 8601. */
  generated_at: string
}
