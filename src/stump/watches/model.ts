import { refuse } from '../actions/refusals.ts'
import {
  assertFeedUrlAllowed, canonicalUrl, compileTerms, hasPositiveTerms, instanceOrigin, normalizeHashtag, REDDIT_REFUSAL, SourceError, TermError,
  type HnStoryType, type TermLogic,
} from '../lib/discovery/index.ts'

export type SourceKind = 'hn' | 'rss' | 'bluesky' | 'mastodon'
export const SOURCE_KINDS: readonly SourceKind[] = ['hn', 'rss', 'bluesky', 'mastodon']
export const HN_TYPES: readonly HnStoryType[] = ['story', 'show_hn', 'ask_hn', 'comment', 'poll']

/** A source as the person configured it, normalised. `key` names it for its state rows. */
export interface WatchSource {
  kind: SourceKind
  key: string
  story_types?: HnStoryType[]
  url?: string
  instance?: string
  hashtags?: string[]
  lang?: string
}

export interface AlertsInput {
  immediate_min_relevance?: number
  slack?: { webhook_url?: string }
  webhook?: { url?: string; secret?: string }
}

export const DEFAULT_INTERVAL_MINUTES = 15
export const DEFAULT_IMMEDIATE_MIN_RELEVANCE = 60

const text = { type: 'string', minLength: 1, maxLength: 200 } as const
const termList = { type: 'array', maxItems: 30, items: text } as const

const sourceItem = {
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: {
    kind: { enum: [...SOURCE_KINDS] },
    story_types: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 40 } },
    url: { type: 'string', minLength: 1, maxLength: 2000 },
    instance: { type: 'string', minLength: 1, maxLength: 253 },
    hashtags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 100 } },
    lang: { type: 'string', minLength: 2, maxLength: 12 },
  },
} as const

export const schemas = {
  watch_id: { type: 'string', minLength: 1, maxLength: 64 },
  name: { type: 'string', minLength: 1, maxLength: 120 },
  product_ids: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 64 } },
  terms: { type: 'object', additionalProperties: false, properties: { all: termList, any: termList, none: termList } },
  /** One source: its kind alone (hn, rss, bluesky, mastodon) or the object add_source and create take. */
  source: { anyOf: [{ enum: [...SOURCE_KINDS] }, sourceItem] },
  sources: { type: 'array', maxItems: 20, items: sourceItem },
  alerts: {
    type: 'object', additionalProperties: false,
    properties: {
      immediate_min_relevance: { type: 'number', minimum: 0, maximum: 100 },
      slack: { type: 'object', additionalProperties: false, properties: { webhook_url: { type: 'string', minLength: 1, maxLength: 2000 } } },
      webhook: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', minLength: 1, maxLength: 2000 }, secret: { type: 'string', minLength: 1, maxLength: 500 } } },
    },
  },
  interval_minutes: { type: 'integer', minimum: 5, maximum: 1440 },
  handle: { type: 'string', minLength: 1, maxLength: 300 },
  author: { type: 'string', minLength: 1, maxLength: 300 },
  event_id: { type: 'string', minLength: 1, maxLength: 100 },
  finding_id: { type: 'string', minLength: 1, maxLength: 64 },
  source_key: { type: 'string', minLength: 1, maxLength: 2100 },
} as const

const TYPE_ALIASES: Record<string, HnStoryType> = { ask: 'ask_hn', show: 'show_hn', stories: 'story', comments: 'comment', polls: 'poll' }
/** "Ask HN", "ask-hn" and "ask_hn" name one story type; anything else is refused. */
function storyType(value: unknown, field: string): HnStoryType {
  const word = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_')
  const type = TYPE_ALIASES[word] ?? word
  if (!HN_TYPES.includes(type as HnStoryType)) refuse('invalid_arguments', { field, reason: `Story types are ${HN_TYPES.join(', ')}.` })
  return type as HnStoryType
}

/** The terms a watch holds, trimmed; refused when they cannot be compiled. */
export function normaliseTerms(input: unknown): TermLogic {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const list = (key: 'all' | 'any' | 'none') => (Array.isArray(value[key]) ? (value[key] as unknown[]) : []).filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  const terms: TermLogic = {}
  for (const key of ['all', 'any', 'none'] as const) { const items = list(key); if (items.length) terms[key] = items }
  try { compileTerms(terms) } catch (error) {
    if (error instanceof TermError) refuse('invalid_arguments', { field: 'terms', reason: error.message })
    throw error
  }
  return terms
}

/** A source named by its kind alone ('hn') reads as `{kind: 'hn'}`. */
export const sourceObject = (input: unknown): Record<string, unknown> =>
  typeof input === 'string' ? { kind: input } : (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

/**
 * One source, checked and keyed. Reddit feeds are refused with the supplier and alert routes (STUMP-WATCH-002.8).
 * `index` -1 names a lone source (add_source).
 */
export function normaliseSource(input: unknown, terms: TermLogic, index = 0): WatchSource {
  const raw = sourceObject(input)
  const kind = raw.kind as SourceKind
  const field = index < 0 ? 'source' : `sources[${index}]`
  if (!SOURCE_KINDS.includes(kind)) refuse('invalid_arguments', { field: `${field}.kind` })
  const positive = hasPositiveTerms(compileTerms(terms))
  if (kind === 'hn') {
    if (!positive) refuse('invalid_arguments', { field: 'terms', reason: 'A Hacker News watch needs at least one all-of or any-of term.' })
    const types = Array.isArray(raw.story_types) ? [...new Set(raw.story_types.map(item => storyType(item, `${field}.story_types`)))] : undefined
    return { kind, key: 'hn', ...(types?.length ? { story_types: types } : {}) }
  }
  if (kind === 'bluesky') {
    if (!positive) refuse('invalid_arguments', { field: 'terms', reason: 'A Bluesky watch needs at least one all-of or any-of term.' })
    return { kind, key: 'bluesky', ...(typeof raw.lang === 'string' ? { lang: raw.lang.trim().toLowerCase() } : {}) }
  }
  if (kind === 'rss') {
    if (typeof raw.url !== 'string') refuse('invalid_arguments', { field: `${field}.url`, reason: 'A feed source needs its url.' })
    let parsed: URL
    try { parsed = assertFeedUrlAllowed(raw.url) } catch (error) {
      if (error instanceof SourceError && error.code === 'reddit_not_a_source') refuse('reddit_not_a_source', { field: `${field}.url`, reason: REDDIT_REFUSAL, alternatives: ['licensed_supplier', 'alerts_you_already_receive'] })
      if (error instanceof SourceError) refuse('invalid_arguments', { field: `${field}.url`, reason: error.message })
      throw error
    }
    return { kind, key: `rss:${canonicalUrl(parsed.href)}`, url: parsed.href }
  }
  if (typeof raw.instance !== 'string') refuse('invalid_arguments', { field: `${field}.instance`, reason: 'A Mastodon source needs its instance.' })
  let host: string, origin: string
  try { ({ host, origin } = instanceOrigin(raw.instance)) } catch (error) {
    if (error instanceof SourceError) refuse('invalid_arguments', { field: `${field}.instance`, reason: error.message })
    throw error
  }
  const tags = Array.isArray(raw.hashtags) ? raw.hashtags : []
  if (!tags.length) refuse('invalid_arguments', { field: `${field}.hashtags`, reason: 'A Mastodon source follows hashtags: name at least one.' })
  let hashtags: string[]
  try { hashtags = [...new Set((tags as string[]).map(normalizeHashtag))] } catch (error) {
    if (error instanceof SourceError) refuse('invalid_arguments', { field: `${field}.hashtags`, reason: error.message })
    throw error
  }
  // An https instance is named by its host; a loopback one (a local Mastodon) keeps its http origin.
  return { kind, key: `mastodon:${host}`, instance: origin.startsWith('https:') ? host : origin, hashtags }
}

export function normaliseSources(input: unknown, terms: TermLogic): WatchSource[] {
  const list = Array.isArray(input) ? input : []
  const sources = list.map((item, index) => normaliseSource(item, terms, index))
  const keys = new Set<string>()
  for (const source of sources) {
    if (keys.has(source.key)) refuse('conflict', { reason: 'Two sources are the same.', source: source.key })
    keys.add(source.key)
  }
  return sources
}

/** The handle form blocks and comparisons use (the library's own). */
export const handleKey = (value: string) => value.trim().replace(/^@+/, '').replace(/\s+/g, ' ').toLowerCase().normalize('NFKC')

export const sourceLabel = (source: WatchSource): string => source.kind === 'hn' ? 'Hacker News' : source.kind === 'rss' ? 'RSS' : source.kind === 'bluesky' ? 'Bluesky' : 'Mastodon'
