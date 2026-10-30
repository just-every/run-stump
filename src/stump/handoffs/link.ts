// Checking a posted hand-off link (STUMP-HANDOFF-002, D-5): it must be on the
// venue, and where docs/networks.md lists a check for the network, the network's
// own public API confirms the post, its author and its text. Reddit, LinkedIn,
// members-only and other pages are confirmed by the person, with no request.
import { refuse } from '../actions/refusals.ts'
import type { StumpEnv } from '../env.ts'
import { htmlToText } from '../lib/mastodon/index.ts'
import { stumpFetch } from '../net/fetch.ts'
import type { VenueRow } from '../venues/model.ts'

const ALIASES: Record<string, string> = { 'old.reddit.com': 'reddit.com', 'new.reddit.com': 'reddit.com', 'np.reddit.com': 'reddit.com', 'twitter.com': 'x.com', 'mobile.twitter.com': 'x.com', 'mobile.x.com': 'x.com' }
const hostOf = (url: URL) => { const host = url.hostname.toLowerCase().replace(/^www\./, ''); return ALIASES[host] ?? host }

export function parseLink(value: string): URL {
  let url: URL
  try { url = new URL(value.trim()) } catch { return refuse('invalid_arguments', { field: 'url', reason: 'Paste the full address of the post.' }) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) refuse('invalid_arguments', { field: 'url', reason: 'Paste the full address of the post.' })
  return url
}

/** The link's place, compared the way a person would: the same site, and for a subreddit the same subreddit. */
export function onVenue(venue: Pick<VenueRow, 'url'>, link: URL): boolean {
  if (!venue.url) return false
  const home = new URL(venue.url)
  if (hostOf(home) !== hostOf(link)) return false
  const subreddit = /^\/r\/([A-Za-z0-9_]+)/.exec(home.pathname)?.[1]?.toLowerCase()
  return !subreddit || /^\/r\/([A-Za-z0-9_]+)/.exec(link.pathname)?.[1]?.toLowerCase() === subreddit
}

/** The same post, whatever the tracking query or trailing slash. */
export const sameLink = (a: string, b: string) => {
  const key = (value: string) => { const url = new URL(value); return `${hostOf(url)}${url.pathname.replace(/\/+$/, '').toLowerCase()}${url.hostname.endsWith('ycombinator.com') ? url.search : ''}` }
  try { return key(a) === key(b) } catch { return false }
}

export type Method = 'bluesky' | 'mastodon' | 'x' | 'hn' | 'person'
export interface Checked { network: string; method: Method; confirmation: 'network' | 'person'; network_id: string | null; author: string | null; text: string | null; posted_at: number | null }

/** How docs/networks.md checks a link at this venue: by its host, or by the venue's own platform for a Mastodon instance. */
export function methodFor(venue: Pick<VenueRow, 'platform' | 'kind'>, link: URL): { method: Method; network: string } {
  const host = hostOf(link), platform = (venue.platform ?? '').toLowerCase()
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) return { method: 'person', network: 'reddit' }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return { method: 'person', network: 'linkedin' }
  if (host === 'bsky.app') return { method: 'bluesky', network: 'bluesky' }
  if (host === 'x.com') return { method: 'x', network: 'x' }
  if (host === 'news.ycombinator.com') return { method: 'hn', network: 'hn' }
  if (venue.kind === 'slack' || host.endsWith('slack.com')) return { method: 'person', network: 'slack' }
  if (venue.kind === 'discord' || host === 'discord.com') return { method: 'person', network: 'discord' }
  if (platform === 'mastodon' || /^\/@[^/]+\/\d+\/?$/.test(link.pathname)) return { method: 'mastodon', network: 'mastodon' }
  return { method: 'person', network: platform || host }
}

/** The method a venue's links are checked with, from its record alone: what the call is classified by (D-7). */
export function venueMethod(venue: Pick<VenueRow, 'platform' | 'kind' | 'url'>): { method: Method; network: string } | null {
  return venue.url ? methodFor(venue, new URL(venue.url)) : null
}

const bare = (handle: string) => handle.trim().replace(/^@/, '').toLowerCase()

/** Whether the post's author is the person's recorded handle at the venue (STUMP-HANDOFF-002.3). */
export function sameAuthor(method: Method, recorded: string, author: string, host: string): boolean {
  const mine = bare(recorded), theirs = bare(author)
  if (method !== 'mastodon') return mine === theirs
  // Mastodon: a local account's acct has no instance; the recorded handle may carry one.
  const full = (acct: string) => acct.includes('@') ? acct : `${acct}@${host}`
  return mine.includes('@') ? full(mine) === full(theirs) : mine === theirs.split('@')[0]
}

async function read(env: StumpEnv, url: string, network: string): Promise<Record<string, unknown> | null> {
  let response: Response
  try { response = await stumpFetch(env)(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }) }
  catch { return refuse('link_check_failed', { network, reason: `${network} could not be reached to check the link. Try again.` }) }
  if (response.status === 404) { await response.body?.cancel(); return null }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  // Bluesky answers 400 NotFound for a post that does not exist.
  if (response.status === 400 && body && /notfound/i.test(String(body.error ?? ''))) return null
  if (!response.ok || !body) return refuse('link_check_failed', { network, status: response.status, reason: `${network} answered ${response.status} when the link was checked.` })
  return body
}

const notFound = (network: string, url: string): never => refuse('post_not_found', { network, url, reason: `${network} has no post at that link.` })

/** Reads the post back from its network where one is listed; anything else is confirmed by the person, with no request to its pages. */
export async function checkLink(env: StumpEnv, venue: VenueRow, link: URL): Promise<Checked> {
  const { method, network } = methodFor(venue, link), url = link.href
  const person: Checked = { network, method, confirmation: 'person', network_id: null, author: null, text: null, posted_at: null }
  if (method === 'person') return person
  if (method === 'bluesky') {
    const [, actor, rkey] = /^\/profile\/([^/]+)\/post\/([^/]+)\/?$/.exec(link.pathname) ?? []
    if (!actor || !rkey) return notFound(network, url)
    const body = await read(env, `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(`at://${actor}/app.bsky.feed.post/${rkey}`)}&depth=0&parentHeight=0`, network)
    const post = (body?.thread as { post?: { uri?: string; author?: { did?: string; handle?: string }; record?: { text?: string; createdAt?: string } } } | undefined)?.post
    if (!post?.uri) return notFound(network, url)
    return { ...person, confirmation: 'network', network_id: post.uri, author: post.author?.handle ?? post.author?.did ?? null, text: post.record?.text ?? null, posted_at: Date.parse(post.record?.createdAt ?? '') || null }
  }
  if (method === 'mastodon') {
    const id = /\/(\d+)\/?$/.exec(link.pathname)?.[1]
    if (!id) return notFound(network, url)
    const body = await read(env, `${link.origin}/api/v1/statuses/${id}`, network)
    if (!body?.id) return notFound(network, url)
    const account = body.account as { acct?: string } | undefined
    return { ...person, confirmation: 'network', network_id: String(body.id), author: account?.acct ?? null, text: htmlToText(String(body.content ?? '')), posted_at: Date.parse(String(body.created_at ?? '')) || null }
  }
  if (method === 'x') {
    const id = /\/status(?:es)?\/(\d+)/.exec(link.pathname)?.[1]
    if (!id) return notFound(network, url)
    const body = await read(env, `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true&dnt=true`, network)
    if (!body?.author_url) return notFound(network, url)
    const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(String(body.html ?? ''))?.[1]
    return { ...person, confirmation: 'network', network_id: id, author: new URL(String(body.author_url)).pathname.split('/').filter(Boolean)[0] ?? null, text: paragraph ? htmlToText(paragraph) : null, posted_at: null }
  }
  const id = link.searchParams.get('id')
  if (!id || !/^\d+$/.test(id)) return notFound(network, url)
  const body = await read(env, `https://hn.algolia.com/api/v1/items/${id}`, network)
  if (!body?.id) return notFound(network, url)
  return { ...person, confirmation: 'network', network_id: String(body.id), author: typeof body.author === 'string' ? body.author : null,
    text: typeof body.text === 'string' && body.text ? htmlToText(body.text) : typeof body.title === 'string' ? body.title : null,
    posted_at: typeof body.created_at_i === 'number' ? body.created_at_i * 1000 : null }
}
