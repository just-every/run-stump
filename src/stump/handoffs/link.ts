// Checking a posted hand-off link (STUMP-HANDOFF-002, D-5): it must be on the
// venue, and where docs/networks.md lists a check for the network, the network's
// own public API confirms the post, its author and its text. Reddit, LinkedIn,
// members-only and other pages are confirmed by the person, with no request.
import { refuse } from '../actions/refusals.ts'
import type { StumpEnv } from '../env.ts'
import { resolveHandle } from '../lib/bluesky/index.ts'
import { htmlToText } from '../lib/mastodon/index.ts'
import { NotPublicError, publicFetch, stumpFetch } from '../net/fetch.ts'
import type { VenueRow } from '../venues/model.ts'

const ALIASES: Record<string, string> = { 'old.reddit.com': 'reddit.com', 'new.reddit.com': 'reddit.com', 'np.reddit.com': 'reddit.com', 'twitter.com': 'x.com', 'mobile.twitter.com': 'x.com', 'mobile.x.com': 'x.com',
  'discordapp.com': 'discord.com', 'ptb.discord.com': 'discord.com', 'canary.discord.com': 'discord.com' }
const hostOf = (url: URL) => { const host = url.hostname.toLowerCase().replace(/^www\./, ''); return ALIASES[host] ?? host }

export function parseLink(value: string): URL {
  let url: URL
  try { url = new URL(value.trim()) } catch { return refuse('invalid_arguments', { field: 'url', reason: 'Paste the full address of the post.' }) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) refuse('invalid_arguments', { field: 'url', reason: 'Paste the full address of the post.' })
  return url
}

/**
 * A Discord server's id, from the venue's recorded Server (the id, or a
 * discord.com/channels/<server> address) or from its own address when that is a
 * discord.com/channels/<server> link. An invite link (discord.gg/<code>) names no server.
 */
export function discordServer(venue: Pick<VenueRow, 'url' | 'details'>): string | null {
  const fromUrl = (value: string) => { try { const url = new URL(value); return hostOf(url) === 'discord.com' ? /^\/channels\/(\d{5,25})(?:\/|$)/.exec(url.pathname)?.[1] ?? null : null } catch { return null } }
  let recorded: unknown = null
  try { recorded = (JSON.parse(venue.details || '{}') as { server?: unknown }).server } catch { recorded = null }
  if (typeof recorded === 'string') {
    const text = recorded.trim()
    if (/^\d{5,25}$/.test(text)) return text
    const server = fromUrl(text)
    if (server) return server
  }
  return venue.url ? fromUrl(venue.url) : null
}

/** The link's place, compared the way a person would: the same site, for a subreddit the same subreddit, and for a Discord server the same server. */
export function onVenue(venue: Pick<VenueRow, 'url' | 'kind' | 'details'>, link: URL): boolean {
  if (!venue.url) return false
  const home = new URL(venue.url)
  if (venue.kind === 'discord' || hostOf(home) === 'discord.gg' || hostOf(home) === 'discord.com') {
    // A message link is discord.com/channels/<server>/<channel>/<message>; the venue is usually recorded by its invite link.
    const server = discordServer(venue), linked = hostOf(link) === 'discord.com' ? /^\/channels\/(\d{5,25})\//.exec(link.pathname)?.[1] ?? null : null
    return !!server && server === linked
  }
  if (hostOf(home) !== hostOf(link)) return false
  const subreddit = /^\/r\/([A-Za-z0-9_]+)/.exec(home.pathname)?.[1]?.toLowerCase()
  return !subreddit || /^\/r\/([A-Za-z0-9_]+)/.exec(link.pathname)?.[1]?.toLowerCase() === subreddit
}

/** Why a link is not on the venue, in words: for a Discord server recorded only by its invite, how to record the server. */
export function notOnVenueReason(venue: Pick<VenueRow, 'url' | 'kind' | 'details' | 'name'>, link: URL): string {
  if ((venue.kind === 'discord' || /discord\.(gg|com)$/.test(venue.url ? new URL(venue.url).hostname : '')) && !discordServer(venue)) {
    return `${venue.name} is recorded by its invite link, which names no server. Edit the venue and set Server to the server's id (the first number in a discord.com/channels/<server>/… link), then record the link again.`
  }
  if (venue.kind === 'discord') return `That link is not a message in ${venue.name}'s server. Copy the message link (discord.com/channels/…) from that server.`
  return `That link is not on ${venue.name}.`
}

/** The same post, whatever the tracking query or trailing slash. */
export const sameLink = (a: string, b: string) => {
  const key = (value: string) => { const url = new URL(value); return `${hostOf(url)}${url.pathname.replace(/\/+$/, '').toLowerCase()}${url.hostname.endsWith('ycombinator.com') ? url.search : ''}` }
  try { return key(a) === key(b) } catch { return false }
}

export type Method = 'bluesky' | 'mastodon' | 'x' | 'hn' | 'person'
export interface Checked {
  network: string; method: Method; confirmation: 'network' | 'person'; network_id: string | null; author: string | null; text: string | null; posted_at: number | null
  /** Bluesky: the post's author handle as the AppView shows it, and the handles this check resolved to DIDs. */
  author_handle?: string | null; resolved?: Map<string, string | null>
}

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
function sameAuthor(method: Method, recorded: string, author: string, host: string): boolean {
  const mine = bare(recorded), theirs = bare(author)
  if (method !== 'mastodon') return mine === theirs
  // Mastodon: a local account's acct has no instance; the recorded handle may carry one.
  const full = (acct: string) => acct.includes('@') ? acct : `${acct}@${host}`
  return mine.includes('@') ? full(mine) === full(theirs) : mine === theirs.split('@')[0]
}

const APPVIEW = 'https://public.api.bsky.app'

/** A Bluesky handle's DID through the AppView's com.atproto.identity.resolveHandle; a DID stands for itself. Null when no account has that handle. */
async function blueskyDid(env: StumpEnv, actor: string, resolved: Map<string, string | null>): Promise<string | null> {
  const handle = actor.trim().replace(/^@/, '')
  if (handle.startsWith('did:')) return handle
  const key = handle.toLowerCase()
  if (resolved.has(key)) return resolved.get(key)!
  const answer = await resolveHandle({ fetch: stumpFetch(env), timeoutMs: 15_000 }, APPVIEW, key)
  if (!answer.ok) return refuse('link_check_failed', { network: 'bluesky', status: answer.error.status ?? null, reason: `Bluesky could not resolve ${key} when the link was checked. Try again.` })
  resolved.set(key, answer.value)
  return answer.value
}

/**
 * Whether the checked post is by the person's recorded handle at the venue
 * (STUMP-HANDOFF-002.3): on Bluesky, the post's author DID against the DID the
 * recorded handle resolves to; elsewhere, the handle the network shows.
 */
export async function authorMatches(env: StumpEnv, checked: Checked, recorded: string, host: string): Promise<boolean> {
  if (!checked.author) return false
  if (checked.method !== 'bluesky') return sameAuthor(checked.method, recorded, checked.author, host)
  return (await blueskyDid(env, recorded, checked.resolved ?? new Map())) === checked.author
}

/** A post's record is a few kilobytes; a link check reads at most this much of an answer. */
const LINK_ANSWER_BYTES = 1024 * 1024

async function read(env: StumpEnv, url: string, network: string): Promise<Record<string, unknown> | null> {
  let response: Response
  try { response = await publicFetch(env, fetch, { maxBytes: LINK_ANSWER_BYTES })(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }) }
  catch (error) {
    if (error instanceof NotPublicError) return refuse('link_check_failed', { network, reason: 'Stump checks links on public sites only.' })
    return refuse('link_check_failed', { network, reason: `${network} could not be reached to check the link. Try again.` })
  }
  if (response.status === 404) { await response.body?.cancel(); return null }
  let body: Record<string, unknown> | null = null, unread = false
  try { body = await response.json() as Record<string, unknown> | null } catch { unread = true }
  if (unread && response.ok) return refuse('link_check_failed', { network, status: response.status, reason: `${network}'s answer could not be read when the link was checked.` })
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
    // docs/networks.md: the post record and its author DID, from the public AppView. The link names a handle (or a DID); the record lives under the DID.
    const [, actor, rkey] = /^\/profile\/([^/]+)\/post\/([^/]+)\/?$/.exec(link.pathname) ?? []
    if (!actor || !rkey) return notFound(network, url)
    const resolved = new Map<string, string | null>(), did = await blueskyDid(env, decodeURIComponent(actor), resolved)
    if (!did) return notFound(network, url)
    const body = await read(env, `${APPVIEW}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(`at://${did}/app.bsky.feed.post/${rkey}`)}&depth=0&parentHeight=0`, network)
    const post = (body?.thread as { post?: { uri?: string; author?: { did?: string; handle?: string }; record?: { text?: string; createdAt?: string } } } | undefined)?.post
    if (!post?.uri) return notFound(network, url)
    return { ...person, confirmation: 'network', network_id: post.uri, author: post.author?.did ?? null, author_handle: post.author?.handle ?? null, resolved,
      text: post.record?.text ?? null, posted_at: Date.parse(post.record?.createdAt ?? '') || null }
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
