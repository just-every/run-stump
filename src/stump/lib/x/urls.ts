/**
 * Finds the URLs X would shorten with t.co. Used for the URL-post price and for
 * the weighted length (every URL weighs 23).
 *
 * X linkifies `scheme://...` and bare `domain.tld/...` for a known top-level
 * domain. This list is the common set; a rare TLD is read as plain text.
 * Handles (`@name.com`), hashtags and email addresses are not URLs.
 */
const TLDS = [
  'com', 'org', 'net', 'edu', 'gov', 'io', 'co', 'ai', 'app', 'dev', 'me', 'us', 'uk', 'ca', 'de', 'fr', 'es',
  'it', 'nl', 'se', 'no', 'dk', 'fi', 'pl', 'ch', 'at', 'be', 'ie', 'pt', 'au', 'nz', 'jp', 'kr', 'cn', 'in',
  'br', 'mx', 'ru', 'za', 'eu', 'info', 'biz', 'xyz', 'tv', 'fm', 'sh', 'to', 'ly', 'gg', 'so', 'cc', 'ws',
  'tech', 'site', 'online', 'cloud', 'blog', 'news', 'club', 'shop', 'store', 'page', 'link', 'wiki', 'live',
  'run', 'sx', 'gl', 'gd', 'is', 'id', 'sg', 'hk', 'tw', 'tk', 'ml', 'vc',
]

const SCHEME_URL = /\bhttps?:\/\/[^\s<>"'`]+/giu
const BARE_URL = new RegExp(
  String.raw`(?<![@#\w./:-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${TLDS.join('|')})(?![\w-])(?::\d{1,5})?(?:/[^\s<>"'\u0060]*)?`,
  'giu',
)

const TRAILING = /[.,!?;:)\]}'"”’]+$/u

export interface UrlSpan {
  start: number
  end: number
  url: string
}

/** URL spans in `text` (UTF-16 offsets), in order, without overlaps. */
export function extractUrls(text: string): UrlSpan[] {
  const spans: UrlSpan[] = []
  const take = (re: RegExp) => {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      let url = m[0]
      const trimmed = url.replace(TRAILING, '')
      if (trimmed.length === 0) continue
      url = trimmed
      const start = m.index ?? 0
      spans.push({ start, end: start + url.length, url })
    }
  }
  take(SCHEME_URL)
  take(BARE_URL)
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: UrlSpan[] = []
  for (const s of spans) {
    const last = out[out.length - 1]
    if (last && s.start < last.end) continue
    out.push(s)
  }
  return out
}
