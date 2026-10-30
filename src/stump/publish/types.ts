import type { StumpEnv } from '../env.ts'

/** A scheduled item as the scheduler hands it to a network's publisher. */
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
  options: Record<string, unknown>
  scheduled_at: number
}

/**
 * What a network answered. posted carries the network's own id and URL read
 * back from that network (D-5); uncertain becomes a hold with an owner and is
 * never retried blindly; partly_posted keeps the parts that went out.
 */
export type PublishOutcome =
  | { state: 'posted'; url: string; network_id: string; posted_at: number; charge_usd?: number; text?: string }
  | { state: 'partly_posted'; url: string; network_id: string; posted_parts: number; error: { code: string; message: string } }
  | { state: 'failed'; error: { code: string; message: string } }
  | { state: 'uncertain'; error: { code: string; message: string } }

export interface PublishContext {
  db: D1Database
  env: StumpEnv
  /** The one outbound fetch (src/stump/net): every network request goes through it. */
  fetch: typeof fetch
  now(): number
}

/** One network's publishing adapter. The publishing lane fills src/stump/publish/publishers.ts. */
export interface Publisher {
  publish(item: DueItem, ctx: PublishContext): Promise<PublishOutcome>
}
