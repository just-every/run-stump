/**
 * Text sanitising. Everything a source returns is untrusted: findings carry plain text only
 * (STUMP-WATCH-002.7). HTML is reduced to text, scripts and styles are dropped with their content,
 * entities are decoded once, control and bidi-override characters are removed.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
  bull: '•', middot: '·', laquo: '«', raquo: '»', euro: '€', pound: '£',
  yen: '¥', cent: '¢', sect: '§', deg: '°', times: '×', divide: '÷',
  para: '¶', larr: '←', rarr: '→', uarr: '↑', darr: '↓', plusmn: '±',
  frac12: '½', frac14: '¼', frac34: '¾', iexcl: '¡', iquest: '¿',
  shy: '', zwj: '‍', zwnj: '‌',
}

/** Decode `&name;`, `&#10;` and `&#x1F600;`. Unknown names stay as written. Invalid code points become U+FFFD. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, (whole, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�'
      return String.fromCodePoint(cp)
    }
    const hit = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()]
    return hit === undefined ? whole : hit
  })
}

// C0 and C1 controls except tab/newline, bidi embeddings and overrides (text spoofing), zero-width
// space, word joiner and BOM. ZWJ and ZWNJ stay: emoji sequences and Persian need them.
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​⁠﻿‪-‮⁦-⁩]/g

export function stripControls(s: string): string {
  return s.replace(CONTROLS, '')
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'br', 'li', 'tr', 'ul', 'ol', 'table', 'blockquote', 'pre', 'hr', 'section', 'article',
  'header', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dd', 'dt', 'dl', 'figure', 'figcaption', 'aside',
])
const DROP_CONTENT = 'script|style|noscript|iframe|object|embed|template|svg|math|head|title|textarea|select|button|form'

const DROP_RE = new RegExp(`<(${DROP_CONTENT})\\b[^>]*>[\\s\\S]*?(?:</\\1\\s*>|$)`, 'gi')
// A tag runs to the first `>` (or the end). A quoted `>` inside an attribute leaves attribute text behind
// as plain text, which is harmless in plain-text output and keeps the scan linear.
const TAG_RE = /<\/?([A-Za-z][A-Za-z0-9:-]*)[^>]*(?:>|$)/g
const COMMENT_RE = /<!--[\s\S]*?(?:-->|$)|<![A-Za-z][^>]*>|<\?[\s\S]*?(?:\?>|$)/g

function stripOnce(html: string): string {
  let out = html.replace(COMMENT_RE, ' ').replace(DROP_RE, ' ')
  out = out.replace(TAG_RE, (_m, name: string) => {
    const n = name.toLowerCase()
    if (n === 'li' && !_m.startsWith('</')) return '\n- '
    return BLOCK_TAGS.has(n) ? '\n' : ''
  })
  return decodeEntities(out)
}

function looksLikeMarkup(s: string): boolean {
  return /<\/?[A-Za-z!?][^>]*>?/.test(s)
}

/** Whitespace tidy-up: NBSP to space, runs of spaces collapsed, at most one blank line. */
export function tidy(s: string): string {
  return s
    .replace(/[  -   　]/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\r?\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Reduce markup to plain text. Run up to twice so double-escaped markup (`&amp;lt;script&amp;gt;`)
 * is also reduced; what comes out contains no tag-like sequences.
 */
export function htmlToText(input: string): string {
  let text = stripControls(input)
  for (let pass = 0; pass < 3; pass++) {
    text = stripOnce(text)
    if (!looksLikeMarkup(text)) break
  }
  // If tag-like text survived all passes (e.g. `<a` with no closing), drop the angle brackets.
  if (looksLikeMarkup(text)) text = text.replace(/<(?=[A-Za-z!?/])/g, '').replace(/(?<=[A-Za-z0-9"'/])>/g, '')
  return tidy(stripControls(text)).normalize('NFC')
}

let graphemeSegmenter: Intl.Segmenter | undefined
function graphemes(): Intl.Segmenter {
  graphemeSegmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' })
  return graphemeSegmenter
}

/** Cut to at most `max` user-perceived characters, never inside an emoji or combining sequence. */
export function truncateGraphemes(s: string, max: number, ellipsis = '…'): string {
  if (s.length <= max) return s
  let n = 0
  let end = 0
  for (const g of graphemes().segment(s)) {
    if (n === max) return `${s.slice(0, end).trimEnd()}${ellipsis}`
    n += 1
    end = g.index + g.segment.length
  }
  return s
}

/** A one-line title for posts that have none: the first non-empty line, cut to `max` characters. */
export function excerptTitle(text: string, max = 100): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  return truncateGraphemes(line, max)
}

/** Split into sentences with the platform's segmenter (Unicode-aware, no English-only punctuation rules). */
export function sentences(text: string): string[] {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' })
  return [...seg.segment(text)].map((s) => s.segment.trim()).filter(Boolean)
}

/**
 * http(s) targets of `<a href>` links in HTML, decoded, at most `max`. Used so a link to the company's
 * site counts as a mention. Mention and hashtag anchors (Mastodon) point at profile and tag pages on
 * the instance, not at anything the author linked, so they are skipped.
 */
export function extractLinks(html: string, max = 20): string[] {
  const out: string[] = []
  const re = /<a\b([^>]*)>/gi
  for (let m = re.exec(html); m && out.length < max; m = re.exec(html)) {
    const attrs = m[1]
    if (/\bclass\s*=\s*["'][^"']*\b(mention|hashtag)\b/i.test(attrs)) continue
    const h = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
    const href = decodeEntities(h?.[1] ?? h?.[2] ?? '').trim()
    if (/^https?:\/\//i.test(href) && !out.includes(href)) out.push(href)
  }
  return out
}
