import { compileTerms, matchTerms, type Finding, type HandleRef, type RankContext, type TermInput } from '../lib/discovery/index.ts'
import type { WatchRow } from './store.ts'

/** A product as listening reads it; `match_case` when its names count only written as recorded ("Rota", never "a month rota"). */
export interface ProductInfo { id: string; name: string; names: string[]; competitors: string[]; match_case: boolean }
export interface Mention { kind: 'product' | 'competitor'; product_id: string; product: string; matched: string }

interface ProductRow { id: string; name: string; names: string; competitors: string; match_case: number | null }

export async function loadProducts(db: D1Database): Promise<ProductInfo[]> {
  const rows = (await db.prepare('SELECT id,name,names,competitors,match_case FROM stump_products ORDER BY name,id').all<ProductRow>()).results
  return rows.map(row => ({ id: row.id, name: row.name, names: strings(row.names), competitors: strings(row.competitors), match_case: Number(row.match_case ?? 0) === 1 }))
}

const strings = (json: string): string[] => { try { const value: unknown = JSON.parse(json); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [] } catch { return [] } }
const namesOf = (product: ProductInfo): TermInput[] => [product.name, ...product.names].map(name => product.match_case ? { text: name, match_case: true as const } : name)

/**
 * Handles recorded for the company's own people and connected accounts (STUMP-WATCH-013.3): a post by
 * any of them never becomes a finding. Accounts carry their instance, so a Mastodon account is
 * `user@instance`; a person's handle on a venue is kept as recorded, for every source.
 */
export async function teamHandles(db: D1Database): Promise<HandleRef[]> {
  const accounts = (await db.prepare('SELECT network,handle,instance FROM stump_accounts').all<{ network: string; handle: string; instance: string | null }>()).results
  const members = (await db.prepare('SELECT DISTINCT handle FROM stump_venue_members').all<{ handle: string }>()).results
  const refs: HandleRef[] = []
  for (const account of accounts) {
    const handle = account.handle.trim().replace(/^@+/, '')
    if (!handle) continue
    const source = account.network === 'bluesky' || account.network === 'mastodon' ? account.network : undefined
    const full = account.network === 'mastodon' && account.instance && !handle.includes('@') ? `${handle}@${account.instance.replace(/^https?:\/\//, '').replace(/\/+$/, '')}` : handle
    refs.push(source ? { source, handle: full } : { handle: full })
  }
  for (const member of members) if (member.handle.trim()) refs.push({ handle: member.handle })
  return refs
}

/** What the watch's ranking knows about the company: its products' names, and its competitors as things it can answer about. */
export function rankContext(watch: Pick<WatchRow, 'terms' | 'product_ids'>, products: ProductInfo[], now: number): RankContext {
  const chosen = watch.product_ids.length ? products.filter(product => watch.product_ids.includes(product.id)) : products
  return {
    terms: watch.terms,
    product_terms: chosen.flatMap(namesOf),
    topic_terms: chosen.flatMap(product => product.competitors),
    now,
  }
}

/** Products and competitors recognised in a finding by name or other name (STUMP-BRAND-001.2). */
export function mentionsOf(finding: Pick<Finding, 'title' | 'text' | 'links'>, products: ProductInfo[]): Mention[] {
  const haystack = { title: finding.title, text: finding.text, links: finding.links.join('\n') }
  const out: Mention[] = []
  for (const product of products) {
    const own = matchTerms(compileTerms({ any: namesOf(product) }), haystack)
    if (own.matched_terms.length) out.push({ kind: 'product', product_id: product.id, product: product.name, matched: own.matched_terms[0]! })
    const rival = matchTerms(compileTerms({ any: product.competitors }), haystack)
    if (rival.matched_terms.length) out.push({ kind: 'competitor', product_id: product.id, product: product.name, matched: rival.matched_terms[0]! })
  }
  return out
}
