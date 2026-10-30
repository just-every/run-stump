/**
 * What each X call costs, from the price table the company sets.
 *
 * Source: https://docs.x.com/x-api/getting-started/pricing (read 30 Oct 2026):
 * post create, post create with URL, post read (per resource), owned read (per
 * resource). Writes are billed per request, reads per resource returned.
 * The defaults mirror docs/networks.md; the app never hard-codes them elsewhere.
 *
 * Not in the four-row table (and so not priced here): X's separate price for a
 * "summoned" post create ($0.010), user reads ($0.010 per resource) and DM events.
 */
import { extractUrls } from './urls'
import type { XChargeAct, XChargeQuote, XPriceTable } from './types'

export const X_DEFAULT_PRICES: Readonly<XPriceTable> = Object.freeze({
  post: 0.015,
  post_with_url: 0.2,
  read: 0.005,
  owned_read: 0.001,
})

const PRICE_KEYS: (keyof XPriceTable)[] = ['post', 'post_with_url', 'read', 'owned_read']

export type XPriceValidation = { ok: true; table: XPriceTable } | { ok: false; error: string; field: string | null }

/**
 * Checks a price table a person typed. Every price is a finite, non-negative USD
 * amount with at most six decimals (one millionth of a dollar).
 */
export function validateXPriceTable(input: unknown): XPriceValidation {
  if (!input || typeof input !== 'object') return { ok: false, error: 'The price table must be an object.', field: null }
  const raw = input as Record<string, unknown>
  const table = {} as XPriceTable
  for (const key of PRICE_KEYS) {
    const v = raw[key]
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return { ok: false, error: `${key} must be a number of dollars, zero or more.`, field: key }
    }
    if (Math.abs(n * 1e6 - Math.round(n * 1e6)) > 1e-6) {
      return { ok: false, error: `${key} has more than six decimal places.`, field: key }
    }
    table[key] = Math.round(n * 1e6) / 1e6
  }
  return { ok: true, table }
}

function toMicro(usd: number): number {
  return Math.round(usd * 1e6)
}

function quote(act: XChargeAct, units: number, unitPrice: number): XChargeQuote {
  const micro = toMicro(unitPrice) * units
  return { counterparty: 'X', act, units, unit_price_usd: unitPrice, usd: micro / 1e6, usd_micro: micro }
}

/** True when X would treat the text as carrying a URL (the URL-post price). */
export function postHasUrl(text: string): boolean {
  return extractUrls(text).length > 0
}

/** The charge for creating one post: the URL price when the text carries a URL, else the plain price. */
export function quoteXPost(text: string, prices: XPriceTable): XChargeQuote {
  return postHasUrl(text) ? quote('post_with_url', 1, prices.post_with_url) : quote('post', 1, prices.post)
}

/** The charge for a whole thread, one quote per part. */
export function quoteXThread(texts: string[], prices: XPriceTable): { quotes: XChargeQuote[]; usd: number; usd_micro: number } {
  const quotes = texts.map((t) => quoteXPost(t, prices))
  const usd_micro = quotes.reduce((s, q) => s + q.usd_micro, 0)
  return { quotes, usd: usd_micro / 1e6, usd_micro }
}

/**
 * The charge for reading `resources` posts. Owned reads (the account's own posts
 * on its own app) use the owned-read price; everything else, such as the mentions
 * timeline, uses the post-read price.
 */
export function quoteXRead(resources: number, prices: XPriceTable, owned = false): XChargeQuote {
  const n = Math.max(0, Math.floor(resources))
  return owned ? quote('owned_read', n, prices.owned_read) : quote('read', n, prices.read)
}

/** Adds quotes into one total in millionths of a dollar. */
export function sumCharges(quotes: XChargeQuote[]): { usd: number; usd_micro: number } {
  const usd_micro = quotes.reduce((s, q) => s + q.usd_micro, 0)
  return { usd: usd_micro / 1e6, usd_micro }
}
