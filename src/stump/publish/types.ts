import type { AccountRow } from '../accounts/store.ts'
import type { StumpEnv } from '../env.ts'
import type { XPriceTable } from '../lib/x/index.ts'

export interface Media { id: string; name: string; type: string; size: number; alt: string | null; bytes: Uint8Array }

/** A scheduled item as the scheduler hands it to a network's publisher: the exact revision it claimed. */
export interface DueItem {
  id: string
  format: 'post' | 'thread' | 'reply' | 'pitch'
  network: string
  account_id: string
  person_id: string
  revision: number
  text: string | null
  parts: string[] | null
  reply_to: { url: string } | null
  /** What the composer recorded beside the text: poll, content_warning, visibility, link. */
  options: ItemOptions
  scheduled_at: number
  media: Media[]
}

export interface ItemOptions {
  poll?: { options: string[]; duration_minutes?: number; expires_in?: number; multiple?: boolean }
  content_warning?: string
  visibility?: 'public' | 'unlisted' | 'followers' | 'private'
  link?: { url: string; title: string; description?: string }
  [key: string]: unknown
}

export interface NetworkError { code: string; message: string }

/**
 * What a network answered. posted carries the network's own id and URL read
 * back from that network, with the text it holds (D-5); uncertain becomes a
 * hold with an owner and is never retried blindly; partly_posted keeps the
 * parts that went out; held waits for its next attempt time or for a person.
 */
export type PublishOutcome =
  | { state: 'posted'; url: string; network_id: string; posted_at: number; text: string }
  | { state: 'partly_posted'; url: string; network_id: string; posted_parts: number; error: NetworkError }
  | { state: 'failed'; error: NetworkError }
  | { state: 'uncertain'; error: NetworkError }
  | { state: 'held'; error: NetworkError; next_attempt_at: number | null; kind: 'rate_limit' | 'day_limit' | 'credits' | 'reconnect' | 'rule' }

export interface PublishContext {
  db: D1Database
  env: StumpEnv
  account: AccountRow
  prices: XPriceTable
  now(): number
}

/** A problem that stops an item being scheduled to an account: its network's own limits and formats. */
export interface Problem { code: string; message: string; path?: string }

/** One network's publishing adapter (src/stump/publish/publishers.ts lists them). */
export interface Publisher {
  /** Checks the item against the account's network before it may be scheduled. Sends nothing that posts. */
  check(item: DueItem, ctx: PublishContext): Promise<Problem[]>
  /** What publishing the item costs at the network from the company's price table, in millionths of a dollar. */
  quote?(item: DueItem, prices: XPriceTable): number
  publish(item: DueItem, ctx: PublishContext): Promise<PublishOutcome>
  /** Reads one of the account's posts back from the network by its address, for an owner settling an uncertain item. */
  readBack?(url: string, ctx: PublishContext): Promise<ReadBack>
}

export type ReadBack = { ok: true; url: string; network_id: string; text: string | null } | { ok: false; message: string }
