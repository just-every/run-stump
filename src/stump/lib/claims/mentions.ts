// Mentions of the company's products, their competitors and its people in a text
// (STUMP-BRAND-001 recognition, which disclosure (STUMP-TRUTH-002) and the claim
// check read). Matching is on whole words, case-insensitive unless the profile asks
// for exact capitalisation, so "Orbit's" and "orbit" match "Orbit". A link to one of a
// product's own URLs (its host, under the URL's path when it has one) is a mention too. Names inside a text are data: nothing found
// here changes a route, a rule or a role.

import { escapeRegExp } from './sentences'
import type { PersonProfile, ProductProfile } from './types'

export interface Mention {
  /** product id, competitor name or person id. */
  id: string
  /** The name or handle the profile holds. */
  name: string
  /** The text as it appears in the draft. */
  text: string
  start: number
  end: number
  via: 'name' | 'other_name' | 'url' | 'handle' | 'alias'
  /** The draft uses the profile's exact capitalisation. */
  exact_case: boolean
}

export interface CompetitorMention extends Mention {
  /** The product the competitor was listed under. */
  product_id: string
}

export interface AvoidMention {
  product_id: string
  word: string
  text: string
  start: number
  end: number
}

export interface MentionSet {
  products: Mention[]
  competitors: CompetitorMention[]
  people: Mention[]
  avoid: AvoidMention[]
  /** The company's own name, when given. */
  company: Mention[]
}

export interface MentionInput {
  products?: readonly ProductProfile[]
  people?: readonly PersonProfile[]
  /** The company's own name and other names. */
  company_names?: readonly string[]
}

/**
 * A name's words as a pattern, without word boundaries. Where letters meet digits the space is optional
 * either way, as the claim check folds text (foldText): "Quillmate 2905d0" matches "Quillmate2905d0", and
 * "SOC2" matches "SOC 2". Disclosure reads names the same way, so a name found here is found there too.
 */
export function namePattern(name: string): string {
  const words = name.trim().split(/\s+/)
  return words.map((word, k) => {
    const lead = /^(\p{L}{2,})(\p{N}.*)$/u.exec(word)
    const pieces = lead ? `${escapeRegExp(lead[1] as string)}\\s*${escapeRegExp(lead[2] as string)}` : escapeRegExp(word)
    if (k === 0) return pieces
    const joint = /\p{L}$/u.test(words[k - 1] as string) && /^\p{N}/u.test(word) ? '\\s*' : '\\s+'
    return `${joint}${pieces}`
  }).join('')
}

/** A name as whole words (namePattern). */
function wordPattern(name: string): string {
  return `(?<![\\p{L}\\p{N}_])${namePattern(name)}(?![\\p{L}\\p{N}_])`
}
/** The same name whatever its spacing, for comparing how a mention is written. */
const unspaced = (text: string) => text.replace(/\s+/g, '')

function findAll(text: string, name: string, caseSensitive: boolean): Array<{ text: string; start: number; end: number }> {
  if (name.trim() === '') return []
  const re = new RegExp(wordPattern(name), caseSensitive ? 'gu' : 'giu')
  const out: Array<{ text: string; start: number; end: number }> = []
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0
    out.push({ text: m[0], start, end: start + m[0].length })
  }
  return out
}

/** A path as links are compared: lower-case, with no trailing slash or trailing sentence punctuation ("" for the site's root). */
const pathKey = (path: string) => path.toLowerCase().replace(/[.,;:!?)\]'"]+$/u, '').replace(/\/+$/, '')

function hostsIn(text: string): Array<{ host: string; path: string; text: string; start: number; end: number }> {
  const out: Array<{ host: string; path: string; text: string; start: number; end: number }> = []
  // A host starts at a word boundary, never inside "a-b" or "a.b", so each run is scanned once.
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_@.-])(?:https?:\/\/)?((?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,})(?::\d+)?(\/[^\s<>"?#]*)?(?:[?#][^\s<>"]*)?/giu)) {
    const start = m.index ?? 0
    out.push({ host: (m[1] as string).toLowerCase(), path: pathKey(m[2] ?? ''), text: m[0], start, end: start + m[0].length })
  }
  return out
}

/** Where a product lives: its host, and its path when the product has a page of its own on a shared site. */
function productPlace(url: string): { host: string; path: string } | null {
  const host = hostOfUrl(url)
  if (!host) return null
  const path = /^[^/?#]*(\/[^?#]*)?/.exec(url.trim().replace(/^https?:\/\//i, ''))?.[1] ?? ''
  return { host, path: pathKey(path) }
}

/** The lower-case host of a URL or bare domain, without "www.". */
export function hostOfUrl(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '')
}

/** Sorted by position, with a mention dropped when a longer one of the same id covers it ("Orbit" inside "Orbit CRM" or "orbit.example"). */
function dedupe<T extends { start: number; end: number; id: string }>(list: T[]): T[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: T[] = []
  // Every earlier mention starts at or before this one, so it is covered when an earlier one of its id ends at or after it.
  const reach = new Map<string, number>()
  for (const m of sorted) {
    const end = reach.get(m.id)
    if (end !== undefined && end >= m.end) continue
    out.push(m)
    reach.set(m.id, m.end)
  }
  return out
}

export function extractMentions(text: string, input: MentionInput): MentionSet {
  const products: Mention[] = []
  const competitors: CompetitorMention[] = []
  const avoid: AvoidMention[] = []
  const people: Mention[] = []
  const company: Mention[] = []

  for (const p of input.products ?? []) {
    const names: Array<{ name: string; via: Mention['via'] }> = [
      { name: p.name, via: 'name' },
      ...(p.other_names ?? []).map((name) => ({ name, via: 'other_name' as const })),
    ]
    for (const { name, via } of names) {
      for (const f of findAll(text, name, p.case_sensitive === true)) {
        products.push({ id: p.id, name, ...f, via, exact_case: unspaced(f.text) === unspaced(name) })
      }
    }
    // A link names the product when it is on the product's host (or a subdomain) and, where the product's URL has a
    // path, under that path: a company's changelog or another product's page on the same site does not name this one.
    const places = (p.urls ?? []).map(productPlace).filter((place): place is { host: string; path: string } => place !== null)
    if (places.length > 0) {
      for (const h of hostsIn(text)) {
        const bare = h.host.replace(/^www\./, '')
        if (places.some((place) => (bare === place.host || bare.endsWith(`.${place.host}`)) && (place.path === '' || h.path === place.path || h.path.startsWith(`${place.path}/`)))) {
          products.push({ id: p.id, name: bare, text: h.text, start: h.start, end: h.end, via: 'url', exact_case: true })
        }
      }
    }
    for (const c of p.competitors ?? []) {
      const cname = typeof c === 'string' ? c : c.name
      const names = [cname, ...(typeof c === 'string' ? [] : (c.aliases ?? []))]
      for (const n of names) {
        for (const f of findAll(text, n, false)) {
          competitors.push({
            id: cname,
            name: n,
            product_id: p.id,
            ...f,
            via: n === cname ? 'name' : 'alias',
            exact_case: unspaced(f.text) === unspaced(n),
          })
        }
      }
    }
    for (const word of p.avoid ?? []) {
      for (const f of findAll(text, word, false)) avoid.push({ product_id: p.id, word, ...f })
    }
  }

  for (const person of input.people ?? []) {
    for (const name of [person.name, ...(person.aliases ?? [])]) {
      for (const f of findAll(text, name, false)) {
        people.push({ id: person.id, name, ...f, via: name === person.name ? 'name' : 'alias', exact_case: unspaced(f.text) === unspaced(name) })
      }
    }
    for (const handle of person.handles ?? []) {
      const h = handle.replace(/^@/, '')
      const re = new RegExp(`(?<![\\p{L}\\p{N}_@.])@${escapeRegExp(h)}(?![\\p{L}\\p{N}_])`, 'giu')
      for (const m of text.matchAll(re)) {
        const start = m.index ?? 0
        people.push({ id: person.id, name: `@${h}`, text: m[0], start, end: start + m[0].length, via: 'handle', exact_case: m[0].slice(1) === h })
      }
    }
  }

  for (const name of input.company_names ?? []) {
    for (const f of findAll(text, name, false)) company.push({ id: name, name, ...f, via: 'name', exact_case: unspaced(f.text) === unspaced(name) })
  }

  return {
    products: dedupe(products),
    competitors: dedupe(competitors.map((c) => ({ ...c }))),
    people: dedupe(people),
    avoid: avoid.sort((a, b) => a.start - b.start),
    company: dedupe(company),
  }
}

/** Distinct product ids named in a draft. */
export function mentionedProductIds(set: MentionSet): string[] {
  return [...new Set(set.products.map((m) => m.id))]
}
