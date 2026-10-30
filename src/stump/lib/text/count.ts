// Per-network counting. Each rule is the network's own:
//
// X: weighted characters, 280 on a standard account.
//   https://docs.x.com/fundamentals/counting-characters
//   Weights come from twitter-text's config v3 (0-4351, 8192-8205, 8208-8223 and
//   8242-8247 weigh 1, every other code point 2, each emoji sequence 2, each URL 23),
//   after Unicode NFC normalisation:
//   https://github.com/twitter/twitter-text/blob/master/config/v3.json
// Bluesky: app.bsky.feed.post text holds at most 300 graphemes and 3,000 UTF-8 bytes
//   (URLs count at full length, there is no shortening).
//   https://docs.bsky.app/docs/advanced-guides/posts
//   https://lexicon.garden/lexicon/did:plc:4v4y5r3lwsbtmsxhile2ljac/app.bsky.feed.post
// Mastodon: the instance's limit (default 500), counted in grapheme clusters, where
//   every http(s) URL counts as characters_reserved_per_url (23) and a mention counts
//   only its @username; the content warning counts too.
//   https://docs.joinmastodon.org/user/posting/
//   https://docs.joinmastodon.org/methods/instance/ (configuration.statuses)
//   https://github.com/mastodon/mastodon/blob/main/app/validators/status_length_validator.rb
// LinkedIn: 3,000 characters of commentary (Share on LinkedIn, Posts API), counted in
//   UTF-16 code units because LinkedIn's services measure Java strings; the escaped
//   little-text form that is sent is checked against the same limit.
//   https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
//   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api

import { graphemeCount, isEmojiGrapheme, normalizeNewlines, splitGraphemes, utf8Length } from './graphemes'
import { escapeLinkedInCommentary } from './linkedin'
import type { CountTarget, Network, TextCount } from './types'
import { extractUrls } from './urls'

export const NETWORK_LIMITS: Readonly<Record<Network, number>> = {
  x: 280,
  bluesky: 300,
  mastodon: 500,
  linkedin: 3000,
}

export const BLUESKY_MAX_BYTES = 3000
export const X_URL_WEIGHT = 23
export const MASTODON_URL_WEIGHT = 23

/** twitter-text config v3: code point ranges (inclusive) that weigh 1; everything else weighs 2. */
const X_LIGHT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
]

function xCodePointWeight(cp: number): number {
  for (const [lo, hi] of X_LIGHT_RANGES) if (cp >= lo && cp <= hi) return 1
  return 2
}

function xWeightOfPlain(text: string): number {
  let weight = 0
  for (const g of splitGraphemes(text)) {
    if (isEmojiGrapheme(g)) {
      weight += 2
      continue
    }
    for (const ch of g) weight += xCodePointWeight(ch.codePointAt(0) as number)
  }
  return weight
}

/** Weighted length on X: NFC first, then URLs at 23, then per-code-point weights. */
export function xWeightedLength(text: string): { weighted: number; urls: number } {
  const normalized = normalizeNewlines(text).normalize('NFC')
  const urls = extractUrls(normalized)
  let weight = 0
  let cursor = 0
  for (const u of urls) {
    weight += xWeightOfPlain(normalized.slice(cursor, u.start))
    weight += X_URL_WEIGHT
    cursor = u.end
  }
  weight += xWeightOfPlain(normalized.slice(cursor))
  return { weighted: weight, urls: urls.length }
}

const MASTODON_MENTION =
  /(?<![=/\p{L}\p{N}_])@([a-z0-9_]+(?:[a-z0-9_.-]+[a-z0-9_]+)?)(@[\p{L}\p{N}_.-]+[\p{L}\p{N}_]+)?/giu

/** Mastodon's countable text: URLs become `url_weight` placeholders, a mention keeps only @username. */
export function mastodonCountableText(text: string, urlWeight = MASTODON_URL_WEIGHT): { text: string; urls: number } {
  const normalized = normalizeNewlines(text)
  const urls = extractUrls(normalized, { bare: false })
  let out = ''
  let cursor = 0
  const plain = (s: string) => s.replace(MASTODON_MENTION, (_m, user: string) => `@${user}`)
  for (const u of urls) {
    out += plain(normalized.slice(cursor, u.start))
    out += 'x'.repeat(urlWeight)
    cursor = u.end
  }
  out += plain(normalized.slice(cursor))
  return { text: out, urls: urls.length }
}

function finish(
  target: CountTarget,
  base: Pick<TextCount, 'count' | 'limit' | 'unit' | 'limit_source' | 'url_count'> & Partial<TextCount>,
  failed: TextCount['failed'],
): TextCount {
  const over = failed.length > 0
  return {
    key: target.key,
    network: target.network,
    remaining: base.limit - base.count,
    over,
    fits: !over,
    failed,
    ...base,
  }
}

function limitFor(target: CountTarget): { limit: number; limit_source: TextCount['limit_source'] } {
  if (target.limit !== undefined) {
    if (!Number.isInteger(target.limit) || target.limit < 1) {
      throw new RangeError(`limit for ${target.network} must be a positive integer`)
    }
    return { limit: target.limit, limit_source: 'target' }
  }
  return { limit: NETWORK_LIMITS[target.network], limit_source: target.network === 'mastodon' ? 'default' : 'network' }
}

export function countText(target: CountTarget, text: string): TextCount {
  const { limit, limit_source } = limitFor(target)
  switch (target.network) {
    case 'x': {
      const { weighted, urls } = xWeightedLength(text)
      const count = weighted
      return finish(target, { count, limit, unit: 'weighted', limit_source, url_count: urls }, count > limit ? ['weighted'] : [])
    }
    case 'bluesky': {
      const normalized = normalizeNewlines(text)
      const count = graphemeCount(normalized)
      const bytes = utf8Length(normalized)
      const failed: TextCount['failed'] = []
      if (count > limit) failed.push('graphemes')
      if (bytes > BLUESKY_MAX_BYTES) failed.push('bytes')
      return finish(target, { count, limit, unit: 'graphemes', limit_source, url_count: 0, bytes }, failed)
    }
    case 'mastodon': {
      const urlWeight = target.url_weight ?? MASTODON_URL_WEIGHT
      const { text: countable, urls } = mastodonCountableText(text, urlWeight)
      const warning = normalizeNewlines(target.content_warning ?? '')
      const count = graphemeCount(warning + countable)
      return finish(target, { count, limit, unit: 'graphemes', limit_source, url_count: urls }, count > limit ? ['characters'] : [])
    }
    case 'linkedin': {
      const normalized = normalizeNewlines(text)
      const count = normalized.length
      const wire = escapeLinkedInCommentary(normalized).length
      const failed: TextCount['failed'] = []
      if (count > limit) failed.push('characters')
      else if (wire > limit) failed.push('wire')
      return finish(target, { count, limit, unit: 'utf16', limit_source, url_count: 0, wire_count: wire }, failed)
    }
    default: {
      const never: never = target.network
      throw new RangeError(`unknown network ${String(never)}`)
    }
  }
}

/** One text counted for several accounts: the result of `stump.drafts.check count`. */
export function countForTargets(text: string, targets: readonly CountTarget[]): TextCount[] {
  return targets.map((t) => countText(t, text))
}
