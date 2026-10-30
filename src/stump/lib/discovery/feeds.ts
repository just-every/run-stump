/**
 * RSS 2.0, RSS 1.0 (RDF) and Atom parsing into feed items. STUMP-WATCH-002.1, .4, .5, .7.
 *
 * Specs: RSS 2.0 https://www.rssboard.org/rss-specification ; Atom RFC 4287
 * https://www.rfc-editor.org/rfc/rfc4287 ; RSS 1.0 https://web.resource.org/rss/1.0/spec ;
 * content:encoded https://web.resource.org/rss/1.0/modules/content/ ; Dublin Core dc:creator and
 * dc:date ; syndication module (sy:updatePeriod) https://web.resource.org/rss/1.0/modules/syndication/ ;
 * Podcasting 2.0 transcripts https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/transcript.md ;
 * iTunes podcast tags https://help.apple.com/itc/podcasts_connect/#/itcb54353390 .
 *
 * Feed content is untrusted: titles and bodies are reduced to plain text (text.ts), links must be
 * http(s), and Google Alerts redirects are unwrapped to the alerted page.
 */
import { SourceError } from './errors.ts'
import { excerptTitle, htmlToText, extractLinks, stripControls } from './text.ts'
import { parseXml, XmlError, child, childrenOf, innerMarkup, is, textOf, type XmlNode } from './xml.ts'
import { parseHttpUrl, unwrapRedirect } from './url.ts'
import type { SourceWarning } from './types.ts'

const ATOM = 'http://www.w3.org/2005/Atom'
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const RSS1 = 'http://purl.org/rss/1.0/'
const CONTENT = 'http://purl.org/rss/1.0/modules/content/'
const DC = 'http://purl.org/dc/elements/1.1/'
const ITUNES = 'http://www.itunes.com/dtds/podcast-1.0.dtd'
const SY = 'http://purl.org/rss/1.0/modules/syndication/'

export interface TranscriptRef {
  url: string
  type: string
  language?: string
  rel?: string
}

export interface FeedItem {
  guid: string
  /** The item's page, redirects unwrapped. */
  url: string
  title: string
  text: string
  author: string
  published_at: string | null
  links: string[]
  categories: string[]
  transcripts: TranscriptRef[]
}

export interface ParsedFeed {
  format: 'rss' | 'rss1' | 'atom'
  title: string
  items: FeedItem[]
  /** Feed's own polling hint in milliseconds (`ttl`, `sy:updatePeriod`), if any. */
  interval_hint_ms?: number
  warnings: SourceWarning[]
}

const rssText = (n: XmlNode, local: string): string | undefined => {
  const c = child(n, local) ?? child(n, local, RSS1)
  return c ? textOf(c).trim() : undefined
}

function firstText(n: XmlNode, specs: [string, string, string?][]): string | undefined {
  for (const [local, ns, prefix] of specs) {
    const c = child(n, local, ns, prefix)
    if (c) {
      const t = textOf(c).trim()
      if (t) return t
    }
  }
  return undefined
}

/** `a@b.example (Jane Doe)` and `Jane Doe <a@b.example>` become `Jane Doe`; a bare address is kept as written. */
export function cleanAuthor(raw: string): string {
  // Look for `Name <address>` and `address (Name)` before reducing markup: `<address>` would read as a tag.
  const s = stripControls(raw).trim()
  const angle = /^(.*?)\s*<[^<>\s]*@[^<>\s]*>$/.exec(s)
  if (angle && angle[1].trim()) return htmlToText(angle[1].trim().replace(/^"(.*)"$/, '$1'))
  const paren = /^[^\s()]*@[^\s()]*\s*\(([^)]+)\)\s*$/.exec(s)
  if (paren) return htmlToText(paren[1])
  return htmlToText(s)
}

export function parseFeedDate(raw: string | undefined, nowMs: number): string | null {
  if (!raw) return null
  const t = Date.parse(raw.trim())
  if (!Number.isFinite(t)) return null
  const year = new Date(t).getUTCFullYear()
  if (year < 1990) return null
  return new Date(Math.min(t, nowMs)).toISOString()
}

function resolve(href: string | undefined, base: string): string | null {
  if (!href) return null
  const u = parseHttpUrl(href, base)
  return u ? unwrapRedirect(u.href) : null
}

function transcriptRefs(item: XmlNode, base: string): TranscriptRef[] {
  const out: TranscriptRef[] = []
  for (const c of item.children) {
    if (c.local !== 'transcript') continue
    if (!(c.ns.includes('podcastindex') || c.ns.includes('podcast-namespace') || c.prefix === 'podcast')) continue
    const url = resolve(c.attrs.url, base)
    if (!url) continue
    out.push({ url, type: (c.attrs.type ?? '').toLowerCase(), language: c.attrs.language, rel: c.attrs.rel })
  }
  return out
}

function longest(...candidates: (string | undefined)[]): string {
  let best = ''
  for (const c of candidates) {
    if (!c) continue
    const t = htmlToText(c)
    if (t.length > best.length) best = t
  }
  return best
}

function rssItem(item: XmlNode, base: string, nowMs: number): FeedItem | null {
  const title = htmlToText(rssText(item, 'title') ?? '')
  const guidEl = child(item, 'guid')
  const guid = guidEl ? textOf(guidEl).trim() : ''
  const isPermaLink = guidEl?.attrs.isPermaLink?.toLowerCase() !== 'false'
  const atomLink = item.children.find((c) => is(c, 'link', ATOM) && (c.attrs.rel ?? 'alternate') === 'alternate')
  const url =
    resolve(rssText(item, 'link'), base) ??
    resolve(atomLink?.attrs.href, base) ??
    (isPermaLink ? resolve(guid, base) : null)
  if (!url || (!title && !guid)) return null
  const body = firstText(item, [['encoded', CONTENT, 'content']])
  const desc = rssText(item, 'description')
  const summary = firstText(item, [['summary', ITUNES, 'itunes'], ['subtitle', ITUNES, 'itunes']])
  const author = firstText(item, [['creator', DC, 'dc'], ['author', ''], ['author', ITUNES, 'itunes']]) ?? ''
  const date = firstText(item, [['pubDate', ''], ['date', DC, 'dc'], ['date', RSS1], ['published', ATOM], ['updated', ATOM]])
  const markup = [body, desc, summary].filter(Boolean).join('\n')
  return {
    guid: guid || url,
    url,
    title: title || excerptTitle(htmlToText(desc ?? '')),
    text: longest(body, desc, summary),
    author: cleanAuthor(author),
    published_at: parseFeedDate(date, nowMs),
    links: [...new Set([url, ...extractLinks(markup)])],
    categories: [...childrenOf(item, 'category'), ...childrenOf(item, 'subject', DC, 'dc')]
      .map((c) => htmlToText(textOf(c)))
      .filter(Boolean),
    transcripts: transcriptRefs(item, base),
  }
}

function atomText(n: XmlNode | undefined): string {
  if (!n) return ''
  const type = (n.attrs.type ?? 'text').toLowerCase()
  if (type === 'xhtml') return htmlToText(innerMarkup(child(n, 'div', 'http://www.w3.org/1999/xhtml') ?? n))
  return htmlToText(textOf(n))
}

function atomEntry(entry: XmlNode, feedBase: string, feedAuthor: string, nowMs: number): FeedItem | null {
  const base = entry.attrs['xml:base'] ? (resolve(entry.attrs['xml:base'], feedBase) ?? feedBase) : feedBase
  const links = childrenOf(entry, 'link', ATOM)
  const alt =
    links.find((l) => (l.attrs.rel ?? 'alternate') === 'alternate' && (!l.attrs.type || /html/i.test(l.attrs.type))) ??
    links.find((l) => (l.attrs.rel ?? 'alternate') === 'alternate')
  const id = firstText(entry, [['id', ATOM]]) ?? ''
  const url = resolve(alt?.attrs.href, base) ?? resolve(id, base)
  const title = atomText(child(entry, 'title', ATOM))
  if (!url || (!title && !id)) return null
  const contentEl = child(entry, 'content', ATOM)
  const summaryEl = child(entry, 'summary', ATOM)
  const authorEl = child(entry, 'author', ATOM)
  const author = authorEl ? atomText(child(authorEl, 'name', ATOM)) : feedAuthor
  const date = firstText(entry, [['published', ATOM], ['updated', ATOM]])
  const markup = [contentEl ? textOf(contentEl) : '', summaryEl ? textOf(summaryEl) : ''].join('\n')
  const text = [atomText(contentEl), atomText(summaryEl)].reduce((a, b) => (b.length > a.length ? b : a), '')
  return {
    guid: id || url,
    url,
    title: title || excerptTitle(text),
    text,
    author,
    published_at: parseFeedDate(date, nowMs),
    links: [...new Set([url, ...extractLinks(markup)])],
    categories: childrenOf(entry, 'category', ATOM)
      .map((c) => htmlToText(c.attrs.term ?? c.attrs.label ?? ''))
      .filter(Boolean),
    transcripts: transcriptRefs(entry, base),
  }
}

const SY_PERIOD_MS: Record<string, number> = {
  hourly: 3_600_000, daily: 86_400_000, weekly: 604_800_000, monthly: 2_592_000_000, yearly: 31_536_000_000,
}

function intervalHint(channel: XmlNode): number | undefined {
  const hints: number[] = []
  const ttl = Number(rssText(channel, 'ttl'))
  if (Number.isFinite(ttl) && ttl > 0) hints.push(ttl * 60_000)
  const period = firstText(channel, [['updatePeriod', SY, 'sy']])?.toLowerCase()
  if (period && SY_PERIOD_MS[period]) {
    const freq = Number(firstText(channel, [['updateFrequency', SY, 'sy']]) ?? 1)
    hints.push(SY_PERIOD_MS[period] / (Number.isFinite(freq) && freq >= 1 ? freq : 1))
  }
  return hints.length ? Math.max(...hints) : undefined
}

/** Parse feed XML. Throws SourceError('parse') for malformed XML and for documents that are not feeds. */
export function parseFeed(xml: string, feedUrl: string, nowMs = Date.now()): ParsedFeed {
  let root: XmlNode
  try {
    root = parseXml(xml)
  } catch (e) {
    if (e instanceof XmlError) throw new SourceError('parse', 'rss', `The feed is not well-formed XML: ${e.message}`)
    throw e
  }
  const warnings: SourceWarning[] = []
  const items: FeedItem[] = []
  const skip = (index: number) =>
    warnings.push({ code: 'item_skipped', message: `Item ${index + 1} has no usable link or title and was skipped` })

  if (root.local === 'rss' && root.prefix === '') {
    const channel = child(root, 'channel')
    if (!channel) throw new SourceError('parse', 'rss', 'The feed is an rss document without a channel')
    const base = resolve(channel.attrs['xml:base'], feedUrl) ?? feedUrl
    childrenOf(channel, 'item').forEach((it, i) => {
      const item = rssItem(it, base, nowMs)
      if (item) items.push(item)
      else skip(i)
    })
    return {
      format: 'rss', title: htmlToText(rssText(channel, 'title') ?? ''), items,
      interval_hint_ms: intervalHint(channel), warnings,
    }
  }
  if (is(root, 'RDF', RDF) || (root.local === 'RDF' && root.prefix === 'rdf')) {
    const channel = child(root, 'channel', RSS1)
    const all = childrenOf(root, 'item', RSS1)
    all.forEach((it, i) => {
      const item = rssItem(it, feedUrl, nowMs)
      if (item) items.push(item)
      else skip(i)
    })
    return {
      format: 'rss1', title: htmlToText(channel ? (rssText(channel, 'title') ?? '') : ''), items,
      interval_hint_ms: channel ? intervalHint(channel) : undefined, warnings,
    }
  }
  if (is(root, 'feed', ATOM)) {
    const base = resolve(root.attrs['xml:base'], feedUrl) ?? feedUrl
    const feedAuthorEl = child(root, 'author', ATOM)
    const feedAuthor = feedAuthorEl ? atomText(child(feedAuthorEl, 'name', ATOM)) : ''
    childrenOf(root, 'entry', ATOM).forEach((en, i) => {
      const item = atomEntry(en, base, feedAuthor, nowMs)
      if (item) items.push(item)
      else skip(i)
    })
    return { format: 'atom', title: atomText(child(root, 'title', ATOM)), items, warnings }
  }
  throw new SourceError('parse', 'rss', `The document is not a feed (its root element is <${root.local}>)`)
}
