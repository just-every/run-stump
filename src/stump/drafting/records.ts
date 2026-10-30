// Rows of the drafting tables and the records both doors return for them.
import type { Claim, ClaimProof, ProductProfile } from '../lib/claims/index.ts'

export type Row = Record<string, unknown>

export const parse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return (value ?? fallback) as T
  try { return JSON.parse(value) as T } catch { return fallback }
}
export const iso = (value: unknown) => typeof value === 'number' ? new Date(value).toISOString() : null
export const today = (now: number) => new Date(now).toISOString().slice(0, 10)
const text = (value: unknown) => typeof value === 'string' ? value : null

export interface ProductRecord {
  id: string; name: string; other_names: string[]; description: string | null; audience: string | null; positioning: string | null
  urls: string[]; competitors: string[]; use_words: string[]; avoid_words: string[]; tone: string; revision: number; updated_at: string | null
}
export const productRecord = (row: Row): ProductRecord => ({
  id: String(row.id), name: String(row.name), other_names: parse(row.names, []), description: text(row.description), audience: text(row.audience),
  positioning: text(row.positioning), urls: parse(row.urls, []), competitors: parse(row.competitors, []), use_words: parse(row.use_words, []),
  avoid_words: parse(row.avoid_words, []), tone: (() => { const tone = parse<unknown>(row.tone, ''); return typeof tone === 'string' ? tone : '' })(),
  revision: Number(row.revision), updated_at: iso(row.updated_at),
})
/** A product as the claim check reads it: names, URLs, competitors and avoided words. */
export const productProfile = (product: ProductRecord): ProductProfile => ({
  id: product.id, name: product.name, other_names: product.other_names, urls: product.urls, competitors: product.competitors, avoid: product.avoid_words,
})

export interface ClaimRecord {
  id: string; product_id: string | null; kind: Claim['kind']; text: string; proof: string | ClaimProof | null; owner_id: string; review_on: string | null
  reason: string | null; competitor: string | null; source_url: string | null; source_date: string | null; aliases: string[]; revision: number
}
export const claimRecord = (row: Row): ClaimRecord => ({
  id: String(row.id), product_id: text(row.product_id), kind: row.kind as Claim['kind'], text: String(row.text), proof: parse(row.proof, null),
  owner_id: String(row.owner_id), review_on: text(row.review_on), reason: text(row.reason), competitor: text(row.competitor), source_url: text(row.source_url),
  source_date: text(row.source_date), aliases: parse(row.aliases, []), revision: Number(row.revision),
})
/** A claim as the claim check reads it. */
export const libClaim = (claim: ClaimRecord): Claim => ({
  id: claim.id, kind: claim.kind, text: claim.text, aliases: claim.aliases, owner_id: claim.owner_id,
  ...(claim.product_id ? { product_id: claim.product_id } : {}), ...(claim.proof !== null ? { proof: claim.proof } : {}),
  ...(claim.review_on ? { review_on: claim.review_on } : {}), ...(claim.reason ? { reason: claim.reason } : {}),
  ...(claim.competitor ? { competitor: claim.competitor } : {}), ...(claim.source_url ? { source_url: claim.source_url } : {}),
  ...(claim.source_date ? { source_date: claim.source_date } : {}),
})

export interface Flag { code: string; blocking: boolean; [fact: string]: unknown }

export const itemRecord = (row: Row) => ({
  id: String(row.id), format: row.format, network: row.network ?? null, account_id: row.account_id ?? null, venue_id: row.venue_id ?? null,
  person_id: row.person_id, product_id: row.product_id ?? null, master_id: row.master_id ?? null, state: row.state, revision: Number(row.revision),
  text: row.text ?? null, parts: parse(row.parts, null), flags: parse<Flag[]>(row.flags, []), routes: parse(row.routes, []),
  claims_used: parse<string[]>(row.claims_used, []), sources: parse(row.sources, []), ai: parse(row.ai, null), url: row.url ?? null,
  network_id: row.network_id ?? null, scheduled_at: iso(row.scheduled_at), time_zone: row.time_zone ?? null, hold: parse(row.hold, null),
  error: parse(row.error, null), recipient: parse(row.recipient, null), subject: row.subject ?? null, reply_to: parse(row.reply_to, null),
  differs_from_master: Number(row.differs_from_master ?? 0), campaign: row.campaign ?? null, options: parse(row.options, {}),
  agent: parse(row.agent, null), approved_by: parse(row.approved_by, null), created_by: row.created_by, created_at: iso(row.created_at), updated_at: iso(row.updated_at),
})
export type ItemRecord = ReturnType<typeof itemRecord>

/** The text an item says, threads joined part by part. */
export const itemText = (item: { text?: unknown; parts?: unknown }) => {
  const parts = Array.isArray(item.parts) ? item.parts as string[] : parse<string[] | null>(item.parts, null)
  return parts?.length ? parts.join('\n\n') : String(item.text ?? '')
}

export const voiceRecord = (row: Row, person: { status: string; display_name: string } | null) => ({
  id: String(row.id), person_id: String(row.person_id), name: person ? `${person.display_name}'s voice` : 'Voice',
  samples: parse<string[]>(row.samples, []), do: parse<string[]>(row.do_list, []), dont: parse<string[]>(row.dont_list, []),
  // A removed person's guide is archived with them and drafts nothing (STUMP-BRAND-002.5).
  state: !person || person.status === 'removed' ? 'archived' : 'active', revision: Number(row.revision), updated_at: iso(row.updated_at),
})
export type VoiceRecord = ReturnType<typeof voiceRecord>

export const contactRecord = (row: Row) => ({
  id: String(row.id), kind: row.kind, name: row.name, beat: row.beat ?? null, publication: row.publication ?? null,
  topics: parse<string[]>(row.topics, []), contact_route: parse<Record<string, unknown> | null>(row.contact_route, null), created_at: iso(row.created_at),
})

export const masterRecord = (row: Row) => ({
  id: String(row.id), person_id: String(row.person_id), product_id: row.product_id ?? null, text: String(row.text),
  account_ids: parse<string[]>(row.account_ids, []), sources: parse(row.sources, []), revision: Number(row.revision), updated_at: iso(row.updated_at),
})
