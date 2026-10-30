// URL detection for counting and link tagging.
//
// X's counter (twitter-text) and Mastodon's counter (its StatusLengthValidator
// uses twitter-text's extractor with extract_url_without_protocol: false) both
// replace URLs by a fixed weight, so the counts depend on which strings are URLs:
//   https://docs.x.com/resources/global/counting-characters (URLs weigh 23)
//   https://github.com/twitter/twitter-text (the extractor the counters are built on)
//   https://github.com/mastodon/mastodon/blob/main/app/validators/status_length_validator.rb
//
// Protocol URLs (http:// or https://) are detected exactly as written. Bare
// domains follow twitter-text's rule: a known top-level domain, and a
// country-code domain only when a path follows. The TLD list here is a compact
// subset of twitter-text's, so a bare domain on a rare TLD reads as plain text.

export interface UrlMatch {
  /** The URL exactly as written in the text. */
  url: string
  /** UTF-16 index of the first character. */
  start: number
  /** UTF-16 index after the last character. */
  end: number
  protocol: boolean
}

const GENERIC_TLDS = new Set(
  (
    'com net org edu gov mil int info biz name pro mobi asia tel travel jobs museum aero coop cat xxx post ' +
    'app dev tech cloud online site store shop blog news agency email software systems network services ' +
    'solutions company digital studio design media world today live life link click zone page run xyz top ' +
    'club vip wiki social community support tools codes works academy business center directory events ' +
    'expert fund group guide help host international ltd management marketing money partners press rocks ' +
    'security team technology tips training university website works finance cash energy holdings capital'
  ).split(' '),
)

// Two-letter file extensions that are not country-code domains (Node.js/Express is not a link).
const NOT_COUNTRY_CODES = new Set(['js', 'ts', 'py', 'rb', 'rs', 'md', 'go', 'cs'])

const TERMINAL_PUNCTUATION = /[.,;:!?'"*_~]/
const TERMINATORS = /[\s<>"`　-〿！-／：-＠［-｀｛-･]/u

function trimTrailing(candidate: string): string {
  let s = candidate
  for (;;) {
    const last = s[s.length - 1]
    if (last === undefined) return s
    if (TERMINAL_PUNCTUATION.test(last)) {
      s = s.slice(0, -1)
      continue
    }
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
    const open = pairs[last]
    if (open) {
      const opens = s.split(open).length - 1
      const closes = s.split(last).length - 1
      if (closes > opens) {
        s = s.slice(0, -1)
        continue
      }
    }
    return s
  }
}

function hostOf(url: string): string {
  const withoutProtocol = url.replace(/^https?:\/\//i, '')
  const authority = withoutProtocol.split(/[/?#]/, 1)[0] ?? ''
  const noUser = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority
  return noUser.replace(/:\d+$/, '').toLowerCase()
}

/** The lower-case host of an http(s) URL or a bare-domain URL. */
export function urlHost(url: string): string {
  return hostOf(url)
}

export interface ExtractUrlOptions {
  /** Find bare domains such as example.com/pricing. Default true. */
  bare?: boolean
  /** Hosts accepted as bare domains whatever their TLD (the company's own domains). */
  extraBareHosts?: readonly string[]
}

const PROTOCOL_URL = /(?<![\p{L}\p{N}_@＠$＄#＃/])https?:\/\/[^\s<>"`　-〿]+/giu
const BARE_CANDIDATE =
  /(?<![\p{L}\p{N}_@＠$＄#＃./:-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}][\p{L}\p{N}-]{0,62}(?::\d{1,5})?(?:[/?#][^\s<>"`　-〿]*)?/giu

export function extractUrls(text: string, options: ExtractUrlOptions = {}): UrlMatch[] {
  const found: UrlMatch[] = []
  const taken: Array<[number, number]> = []
  const overlaps = (a: number, b: number) => taken.some(([s, e]) => a < e && b > s)

  for (const m of text.matchAll(PROTOCOL_URL)) {
    const raw = m[0]
    const cutAt = raw.search(TERMINATORS)
    const url = trimTrailing(cutAt === -1 ? raw : raw.slice(0, cutAt))
    if (!/^https?:\/\/[^/?#\s]+/i.test(url) || !hostOf(url).includes('.') && hostOf(url) !== 'localhost') continue
    const start = m.index ?? 0
    found.push({ url, start, end: start + url.length, protocol: true })
    taken.push([start, start + url.length])
  }

  if (options.bare !== false) {
    const extra = new Set((options.extraBareHosts ?? []).map((h) => h.toLowerCase()))
    for (const m of text.matchAll(BARE_CANDIDATE)) {
      const start = m.index ?? 0
      const raw = m[0]
      const cutAt = raw.search(TERMINATORS)
      const url = trimTrailing(cutAt === -1 ? raw : raw.slice(0, cutAt))
      if (!url || overlaps(start, start + url.length)) continue
      const host = hostOf(url)
      const labels = host.split('.')
      const tld = labels[labels.length - 1] ?? ''
      const hasPath = /[/?#]/.test(url)
      const own = [...extra].some((h) => host === h || host.endsWith(`.${h}`))
      const generic = GENERIC_TLDS.has(tld)
      const countryCode = /^[a-z]{2}$/.test(tld) && !NOT_COUNTRY_CODES.has(tld)
      if (!own && !generic && !(countryCode && hasPath)) continue
      if (labels.some((l) => l.startsWith('-') || l.endsWith('-'))) continue
      found.push({ url, start, end: start + url.length, protocol: false })
      taken.push([start, start + url.length])
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

// Unicode's sentence terminators (UAX #29 STerm and ATerm): ".", "?", "!", "。", "؟", ...
const SENTENCE_TERMINATOR = /\p{Sentence_Terminal}/gu

/**
 * The text with every sentence terminator inside a URL ("?" and "!" in a query, "." in a
 * path) replaced by "X", one per UTF-16 unit, so every offset still points into the
 * original. Intl.Segmenter ends a sentence at the "?" of "https://orbit.run/b?x=1"; segment
 * this copy instead and slice the original by its offsets, and no sentence ends inside a
 * link. "X" is an upper-case letter, which, like the terminator it replaces, stops UAX #29
 * rule SB8 from joining a sentence before the link to the one holding it.
 */
export function maskUrlTerminators(text: string, options: ExtractUrlOptions = {}): string {
  const urls = extractUrls(text, options)
  if (urls.length === 0) return text
  let out = ''
  let cursor = 0
  for (const u of urls) {
    out += text.slice(cursor, u.start) + u.url.replace(SENTENCE_TERMINATOR, (t) => 'X'.repeat(t.length))
    cursor = u.end
  }
  return out + text.slice(cursor)
}
