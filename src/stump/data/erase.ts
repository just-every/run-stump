// Erasure of a person outside the company (STUMP-DATA-002): a journalist by
// their press contact, or an engager by their handles. Their personal data
// leaves press contacts, pitches (which keep an anonymised reference),
// journalist venues and what the venue-list import keeps of them, findings and
// their alerts, the inbox items they wrote, offers to send them to Orbit, and the
// copies of their data the agent door and the refusal records hold. A finding's
// address and the person's handle on each source stay as digests, so no later
// poll brings them back. Each of the company's posts that names them is asked to
// be deleted at its network through that network's publisher, and the answer for
// each ledger entry comes back with its outcome; an entry under legal hold is
// kept and named as kept. What was already sent to Orbit is listed so it can be
// erased there too. The erasure is audited by counts, outcomes and references only.
import { xPrices } from '../accounts/apps.ts'
import { readAccount } from '../accounts/store.ts'
import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import type { D1Sql } from '../../modules/import-kit/src/d1/index.ts'
import { holdOnPost, networkDelete } from '../ledger/correct.ts'
import { fullNameMatcher, nameMatcher, nameParts, pitchStatements } from './anonymise.ts'
import { eraseWithImportCustody, holdsImports, importedVenues, rekeyVenue } from './import-custody.ts'
import { recheckItems } from './recheck.ts'
import { erasureRemoval } from './removal.ts'
import { handleWords, residueStatements, type Trace } from './residue.ts'
import { JOURNALIST_SOURCE } from './erased-uploads.ts'
import { TOMBSTONE_SOURCES, tombstoneStatements, type ErasedFinding } from './tombstones.ts'
import { foldName } from '../lib/imports/index.ts'

const sql = (text: string, ...params: unknown[]): D1Sql => ({ sql: text, params })

export type SubjectKind = 'journalist' | 'engager'
/** Where a handle names a person: the networks Stump publishes to and the sources findings come from. */
export const HANDLE_KEYS = ['x', 'bluesky', 'mastodon', 'linkedin', 'hn', 'rss'] as const
export type HandleKey = typeof HANDLE_KEYS[number]
/** An engager's handles, each on its own network or source: erasing X's @alice never touches a different HN alice. */
export type Handles = Partial<Record<HandleKey, string[]>>
export interface Subject { kind: SubjectKind; contact_id: string | null; handles: Handles }

/** One of the company's ledger entries naming the person. */
interface Named { id: string; network: string | null; account_id: string | null; network_id: string | null; route: string; person_id: string | null; legal_hold: string | null }

/** What a delete request answered for one ledger entry. */
export interface DeletionRequest {
  ledger_id: string; network: string | null
  outcome: 'deleted' | 'not_found' | 'failed' | 'kept' | 'manual'
  /** Why a request failed, why an entry was kept (its legal hold, and the held entry when another entry for the same post holds it), or who removes it by hand. */
  error?: string; hold?: string; held_entry_id?: string; person_id?: string | null
}

/**
 * Other records holding an engager's data, each found and removed by the
 * person's handle on its own network or source: one line per source.
 */
export interface EngagerData {
  name: string
  count(db: D1Database, handles: Handles): Promise<number>
  remove(handles: Handles): D1Sql[]
}

/** The inbox rows an engager wrote, each matched on its own network by the author's handle without '@' or case. */
const inboxMatch = (handles: Handles) => {
  const pairs = Object.entries(handles).filter(([network]) => network !== 'hn' && network !== 'rss').flatMap(([network, list]) => (list ?? []).map(handle => [network, handle] as const))
  return { where: pairs.length ? pairs.map(() => "(network=? AND lower(ltrim(trim(author_handle),'@'))=?)").join(' OR ') : '0', binds: pairs.flat() }
}
const ENGAGER_DATA: readonly EngagerData[] = [{
  // The inbox (STUMP-INBOX-001): their mentions, replies and quotes, with the offer that would take them to Orbit.
  // Removing the row takes its offer and reply links with it; the company's own reply stays an item and a ledger entry.
  name: 'inbox_items',
  async count(db, handles) {
    const { where, binds } = inboxMatch(handles)
    return (await db.prepare(`SELECT COUNT(*) AS n FROM stump_inbox_items WHERE ${where}`).bind(...binds).first<{ n: number }>())?.n ?? 0
  },
  remove(handles) {
    const { where, binds } = inboxMatch(handles)
    return [
      sql(`DELETE FROM stump_stack_offers WHERE id IN (SELECT offer_id FROM stump_inbox_items WHERE offer_id IS NOT NULL AND (${where}))`, ...binds),
      sql(`DELETE FROM stump_inbox_items WHERE ${where}`, ...binds),
    ]
  },
}]

/** A handle as it is written in posts and findings, without its leading '@', compared without case (Mastodon's keeps its '@instance'). */
const folded = (handle: string) => handle.trim().replace(/^@/, '').toLowerCase()
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isKey = (key: string): key is HandleKey => (HANDLE_KEYS as readonly string[]).includes(key)

export function subjectOf(args: Args): Subject {
  const subject = args.subject as { kind?: unknown; contact_id?: unknown; handles?: unknown }
  if (subject.kind === 'journalist') {
    if (subject.handles !== undefined) refuse('invalid_arguments', { field: 'subject.handles', reason: 'A journalist is erased by their press contact.' })
    if (typeof subject.contact_id !== 'string') refuse('invalid_arguments', { field: 'subject.contact_id', reason: 'Name the journalist\'s press contact.' })
    return { kind: 'journalist', contact_id: subject.contact_id, handles: {} }
  }
  if (subject.contact_id !== undefined) refuse('invalid_arguments', { field: 'subject.contact_id', reason: 'An engager is erased by their handles.' })
  const given = subject.handles
  if (!given || typeof given !== 'object' || Array.isArray(given)) refuse('invalid_arguments', { field: 'subject.handles', reason: 'Name each of the engager\'s handles by its network or source, for example {"x": "alice", "hn": "alice"}.' })
  const handles: Handles = {}
  for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
    if (!isKey(key)) refuse('invalid_arguments', { field: `subject.handles.${key}`, reason: `Handles are named by network or source: ${HANDLE_KEYS.join(', ')}.` })
    const list = [...new Set((Array.isArray(value) ? value : [value]).map(handle => folded(String(handle))).filter(Boolean))]
    if (list.length) handles[key] = list
  }
  if (!Object.keys(handles).length) refuse('invalid_arguments', { field: 'subject.handles', reason: 'Name at least one of the engager\'s handles.' })
  return { kind: 'engager', contact_id: null, handles }
}

/** The handles on one network or source. */
const on = (handles: Handles, key: string): string[] => isKey(key) ? handles[key] ?? [] : []

/** A Mastodon handle as user and, when given, the instance it lives on. */
const mastodonParts = (handle: string) => { const at = handle.indexOf('@'); return at < 0 ? { user: handle, host: null } : { user: handle.slice(0, at), host: handle.slice(at + 1) } }
const hostOf = (url: string | null) => { try { return url ? new URL(url).host.toLowerCase() : null } catch { return null } }

/**
 * Whether a post on `network` names one of the person's handles on that
 * network: a mention ('@handle', not inside a longer handle), or a reply to a
 * post at an address that belongs to the handle. A Mastodon handle
 * 'user@instance' matches '@user@instance', and '@user' alone in a post on
 * that same instance.
 */
function namesOnNetwork(network: string, handles: string[], post: { text: string | null; url: string | null; reply_url: string | null }): boolean {
  const end = '(?![\\w-]|\\.\\w|@)', start = '(^|[^\\w@.])@'
  const text = post.text ?? '', reply = post.reply_url ?? ''
  for (const handle of handles) {
    if (network === 'mastodon') {
      const { user, host } = mastodonParts(handle)
      const full = host ? new RegExp(`${start}${escape(user)}@${escape(host)}(?![\\w-]|\\.\\w)`, 'i') : null
      const local = !host || hostOf(post.url) === host ? new RegExp(`${start}${escape(user)}${end}`, 'i') : null
      if ((full && full.test(text)) || (local && local.test(text))) return true
      if (new RegExp(`^https?://${host ? escape(host) : '[^/]+'}/@${escape(user)}(?:/|$)`, 'i').test(reply)) return true
      continue
    }
    if (new RegExp(`${start}${escape(handle)}${end}`, 'i').test(text)) return true
    const address = network === 'x' ? `(?:www\\.)?(?:x|twitter)\\.com/${escape(handle)}` : network === 'bluesky' ? `bsky\\.app/profile/${escape(handle)}` : null
    if (address && new RegExp(`^https?://${address}(?:/|$)`, 'i').test(reply)) return true
  }
  return false
}

/** An offer of the person that already went to a seed: Orbit keeps the contact, so it is erased there too. */
export interface SentOffer { offer_id: string; seed: string; sent_at: string | null; event_id: string | null; signal_id: string | null }

/** Every record the erasure touches, found before anything changes. */
export interface Scope {
  subject: Subject
  contact: { id: string; name: string } | null
  pitches: string[]
  venues: string[]
  findings: string[]
  deliveries: number
  offers: string[]
  /** The inbox items they wrote and the offers linked from them, which leave with them. */
  inbox: { items: string[]; offers: string[] }
  sent: SentOffer[]
  /** Records in the other engager sources, by source name. */
  other: Record<string, number>
  entries: Named[]
}

const namePattern = (name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'iu')

export async function scopeOf(ctx: ActionContext, subject: Subject): Promise<Scope> {
  const db = ctx.db
  const scope: Scope = { subject, contact: null, pitches: [], venues: [], findings: [], deliveries: 0, offers: [], inbox: { items: [], offers: [] }, sent: [], other: {}, entries: [] }
  // The company's posts on the ledger that could name the person: what went out, published or handed off, and is not yet gone.
  const entries = (await db.prepare(`SELECT l.id,l.network,l.account_id,l.network_id,l.route,l.person_id,l.legal_hold,l.text,l.url,i.reply_to,i.recipient FROM stump_ledger l LEFT JOIN stump_items i ON i.id=l.item_id
    WHERE l.route IN ('published','handed_off') AND l.state IN ('posted','uncertain') ORDER BY l.posted_at,l.id`)
    .all<Named & { text: string | null; url: string | null; reply_to: string | null; recipient: string | null }>()).results
  let names: (entry: typeof entries[number]) => boolean
  if (subject.kind === 'journalist') {
    const contact = await db.prepare('SELECT id,name FROM stump_press_contacts WHERE id=?').bind(subject.contact_id).first<{ id: string; name: string }>()
    if (!contact) refuse('not_found', { contact_id: subject.contact_id })
    scope.contact = contact
    scope.venues = (await db.prepare("SELECT id FROM stump_venues WHERE kind='journalist' AND lower(trim(name))=lower(trim(?)) ORDER BY id").bind(contact.name).all<{ id: string }>()).results.map(row => row.id)
    // Pitches to the contact, everything aimed at their venue, and imported entries that name them.
    const marks = scope.venues.map(() => '?').join(',')
    const pitches = new Set((await db.prepare(`SELECT id FROM stump_items WHERE json_extract(recipient,'$.contact_id')=?${scope.venues.length ? ` OR venue_id IN (${marks})` : ''}`)
      .bind(contact.id, ...scope.venues).all<{ id: string }>()).results.map(row => row.id))
    const whole = fullNameMatcher(contact.name), last = nameParts(contact.name).at(-1)?.toLowerCase()
    if (last) for (const row of (await db.prepare('SELECT item_id,value_json FROM stump_item_imports WHERE instr(lower(value_json),?)>0').bind(last).all<{ item_id: string; value_json: string }>()).results) {
      if (whole.test(row.value_json)) pitches.add(row.item_id)
    }
    scope.pitches = [...pitches].sort()
    const named = namePattern(contact.name)
    names = entry => (entry.text !== null && named.test(entry.text)) || (entry.recipient !== null && (JSON.parse(entry.recipient) as { contact_id?: string }).contact_id === contact.id)
  } else {
    const handles = subject.handles
    // Each source's findings by their author on that source, each network's offers by the handle on that network.
    for (const [source, list] of Object.entries(handles)) {
      if (source === 'x' || source === 'linkedin') continue
      const marks = list.map(() => '?').join(',')
      scope.findings.push(...(await db.prepare(`SELECT id FROM stump_findings WHERE source=? AND lower(ltrim(trim(author),'@')) IN (${marks}) ORDER BY id`).bind(source, ...list).all<{ id: string }>()).results.map(row => row.id))
    }
    if (scope.findings.length) {
      const ids = scope.findings.map(() => '?').join(',')
      scope.deliveries = (await db.prepare(`SELECT COUNT(*) AS n FROM stump_watch_deliveries WHERE finding_id IN (${ids})`).bind(...scope.findings).first<{ n: number }>())?.n ?? 0
    }
    for (const [network, list] of Object.entries(handles)) {
      if (network === 'hn' || network === 'rss') continue
      const marks = list.map(() => '?').join(',')
      scope.offers.push(...(await db.prepare(`SELECT id FROM stump_stack_offers WHERE kind='engager' AND network=? AND lower(ltrim(trim(handle),'@')) IN (${marks}) ORDER BY id`).bind(network, ...list).all<{ id: string }>()).results.map(row => row.id))
    }
    for (const source of ENGAGER_DATA) scope.other[source.name] = await source.count(db, handles)
    const { where, binds } = inboxMatch(handles)
    const inbox = (await db.prepare(`SELECT id,offer_id FROM stump_inbox_items WHERE ${where}`).bind(...binds).all<{ id: string; offer_id: string | null }>()).results
    scope.inbox = { items: inbox.map(row => row.id), offers: inbox.map(row => row.offer_id).filter((id): id is string => id !== null) }
    // What already went to a seed: the seed keeps the contact, so the operator erases it there too.
    const offered = [...new Set([...scope.offers, ...scope.inbox.offers])]
    if (offered.length) {
      scope.sent = (await db.prepare(`SELECT id,seed,sent_at,json_extract(outcome,'$.detail.event_id') AS event_id,json_extract(outcome,'$.detail.orbit_signal_id') AS signal_id
        FROM stump_stack_offers WHERE state='sent' AND id IN (${offered.map(() => '?').join(',')}) ORDER BY sent_at,id`).bind(...offered)
        .all<{ id: string; seed: string; sent_at: number | null; event_id: string | null; signal_id: string | null }>()).results
        .map(row => ({ offer_id: row.id, seed: row.seed, sent_at: row.sent_at === null ? null : new Date(row.sent_at).toISOString(), event_id: row.event_id, signal_id: row.signal_id }))
    }
    names = entry => entry.network !== null && namesOnNetwork(entry.network, on(handles, entry.network),
      { text: entry.text, url: entry.url, reply_url: entry.reply_to === null ? null : String((JSON.parse(entry.reply_to) as { url?: string }).url ?? '') })
  }
  scope.entries = entries.filter(names).map(({ id, network, account_id, network_id, route, person_id, legal_hold }) => ({ id, network, account_id, network_id, route, person_id, legal_hold }))
  return scope
}

/** How many records leave Stump: the destructive measure of the call. */
export const removedCount = (scope: Scope) => (scope.contact ? 1 : 0) + scope.pitches.length + scope.venues.length + scope.findings.length + scope.offers.length
  + Object.values(scope.other).reduce((sum, count) => sum + count, 0)

/**
 * Asks the network to delete one of the company's posts naming the person, through its publisher, by the rules
 * the ledger's own removal keeps: only a post the publisher recorded on a company account is deleted, and a post
 * any entry for the same account holds under legal hold stays.
 */
async function requestDeletion(ctx: ActionContext, entry: Named): Promise<DeletionRequest> {
  const answer = { ledger_id: entry.id, network: entry.network }
  if (entry.legal_hold) return { ...answer, outcome: 'kept', hold: (JSON.parse(entry.legal_hold) as { reason?: string }).reason ?? 'legal hold' }
  // A hand-off was posted by the named member from their own account: they remove it by hand.
  if (entry.route === 'handed_off') return { ...answer, outcome: 'manual', person_id: entry.person_id }
  if (!entry.network || !entry.account_id || !entry.network_id) return { ...answer, outcome: 'failed', error: 'The entry has no network address to delete.' }
  const account = await readAccount(ctx.db, entry.account_id)
  if (!account) return { ...answer, outcome: 'failed', error: 'The account that posted it is no longer in Stump.' }
  const target = await networkDelete(ctx, entry)
  // A member's own account, or a network id a correction set: the post is removed at the network by hand.
  if (!target) return { ...answer, outcome: 'manual', person_id: account.owner_kind === 'person' ? account.owner_person_id : null }
  const held = await holdOnPost(ctx, entry, target)
  if (held) return { ...answer, outcome: 'kept', hold: held.reason ?? 'legal hold', held_entry_id: held.id }
  const result = await target.publisher.remove({ network: target.account.network, account_id: target.account.id, network_id: target.network_id },
    { db: ctx.db, env: ctx.env, account: target.account, prices: await xPrices(ctx.db), now: ctx.now })
  return { ...answer, outcome: result.outcome, ...(result.error ? { error: result.error } : {}) }
}

/**
 * What names the person in stored copies: the ids of their erased records, and their handles or their name.
 * A journalist's whole name names them anywhere; a single part of it (a first or last name another person may
 * share) names them only inside a record tied to them, one that also holds their contact's, venue's or a pitch's id.
 */
function traceOf(scope: Scope): Trace {
  if (scope.contact) {
    const ids = [scope.contact.id, ...scope.venues], tied = [...ids, ...scope.pitches], parts = nameParts(scope.contact.name)
    return { ids, words: fullNameMatcher(scope.contact.name), tied: { ids: tied, words: new RegExp(nameMatcher(scope.contact.name).source, 'iu') },
      needles: [...new Set([...tied, ...parts].map(text => text.toLowerCase()))] }
  }
  const handles = Object.values(scope.subject.handles).flat()
  const ids = [...scope.findings, ...scope.offers, ...scope.inbox.items, ...scope.inbox.offers]
  const forms = handles.flatMap(handle => { const at = handle.indexOf('@'); return at > 0 ? [handle, handle.slice(0, at)] : [handle] })
  return { ids, words: handleWords(handles), tied: null, needles: [...new Set([...ids, ...forms].map(text => text.toLowerCase()))] }
}

export async function erase(ctx: ActionContext, scope: Scope) {
  const db = ctx.db, id = crypto.randomUUID()
  const deletion_requests: DeletionRequest[] = []
  for (const entry of scope.entries) {
    const request = await requestDeletion(ctx, entry)
    deletion_requests.push(request)
    // A post gone from its network reads removed on the ledger, with the network's answer; the entry keeps the post.
    if (request.outcome === 'deleted' || request.outcome === 'not_found') {
      await erasureRemoval(db, entry.id, request.outcome, { erasure_id: id, person_id: ctx.person.id, agent_id: ctx.agent?.id ?? null, now: ctx.now() }).run()
      ctx.emit('ledger.removed', `stump://ledger/${entry.id}`, { reason: 'erasure' })
    }
  }

  const now = ctx.now(), statements: D1Sql[] = []
  const list = (ids: string[]) => ids.map(() => '?').join(',')
  let imported: Array<{ venue_id: string; target_id: string }> = []
  if (scope.contact) {
    const reference = { contact_id: null, name: null, route: null, erased: `erasure:${id}` }
    imported = await importedVenues(db, scope.venues)
    // Pitches keep their text with every form of the journalist's name taken out, and an anonymised reference in place of the contact.
    statements.push(sql('DELETE FROM stump_press_contacts WHERE id=?', scope.contact.id), ...await pitchStatements(db, scope.pitches, nameMatcher(scope.contact.name), reference))
    for (const venue of scope.venues) {
      statements.push(sql(`UPDATE stump_venues SET name=?,url=NULL,url_key=NULL,platform=NULL,details='{}',audience=NULL,why=NULL,reader_value=NULL,notes=NULL,rules='{}',shared_limit=NULL,
        excluded=NULL,how_to_post='{}',requirements='{}',reception=NULL,archived=1,archived_at=?,archived_by=?,revision=revision+1,updated_at=? WHERE id=?`, `Erased journalist ${venue.slice(0, 8)}`, now, ctx.person.id, now, venue),
      sql("DELETE FROM stump_venue_history WHERE venue_id=? AND action<>'erased'", venue),
      sql("INSERT INTO stump_venue_history(id,venue_id,action,person_id,agent_id,detail,at) VALUES(?,?,'erased',?,?,?,?)", crypto.randomUUID(), venue, ctx.person.id, ctx.agent?.id ?? null, JSON.stringify({ erasure_id: id }), now))
    }
    // The name, as a keyed digest, keeps a later upload of a list naming them out of the import door.
    statements.push(...await tombstoneStatements(db, id, [], [{ source: JOURNALIST_SOURCE, handle: foldName(scope.contact.name) }]))
    // What the list import wrote becomes Stump's own: an Undo leaves the anonymised venue and pitches alone.
    if (scope.venues.length) statements.push(sql(`DELETE FROM stump_venue_imports WHERE venue_id IN (${list(scope.venues)})`, ...scope.venues))
    if (scope.pitches.length) statements.push(sql(`DELETE FROM stump_item_imports WHERE item_id IN (${list(scope.pitches)})`, ...scope.pitches))
    // The first venue the import wrote takes a new id, so the import's own target for it is erased (and refused if uploaded again).
    if (imported[0]) statements.push(...rekeyVenue(imported[0].venue_id))
  }
  if (scope.subject.kind === 'engager') {
    // Digests of each erased finding's address and of the person's handle on each source keep them out of later polls;
    // on X, their handle and the author id X gave their posts keep the inbox from storing a post of theirs as a thread's context.
    const found = scope.findings.length ? (await db.prepare(`SELECT url_key,source,json_extract(raw,'$.author_id') AS author_id FROM stump_findings WHERE id IN (${list(scope.findings)})`)
      .bind(...scope.findings).all<ErasedFinding>()).results : []
    const xAuthors = scope.inbox.items.length ? (await db.prepare(`SELECT DISTINCT author_id FROM stump_inbox_items WHERE network='x' AND author_id IS NOT NULL AND id IN (${list(scope.inbox.items)})`)
      .bind(...scope.inbox.items).all<{ author_id: string }>()).results.map(row => ({ source: 'x', handle: row.author_id })) : []
    statements.push(...await tombstoneStatements(db, id, found, [...TOMBSTONE_SOURCES.flatMap(source => on(scope.subject.handles, source).map(handle => ({ source, handle }))), ...xAuthors]))
  }
  if (scope.findings.length) {
    statements.push(sql(`DELETE FROM stump_watch_deliveries WHERE finding_id IN (${list(scope.findings)})`, ...scope.findings),
      sql(`DELETE FROM stump_findings WHERE id IN (${list(scope.findings)})`, ...scope.findings))
  }
  if (scope.offers.length) statements.push(sql(`DELETE FROM stump_stack_offers WHERE id IN (${list(scope.offers)})`, ...scope.offers))
  if (scope.subject.kind === 'engager') for (const source of ENGAGER_DATA) statements.push(...source.remove(scope.subject.handles))
  const residue = await residueStatements(db, traceOf(scope), id)
  statements.push(...residue.statements)
  const counts: Record<string, number> = { ...scope.other, press_contacts: scope.contact ? 1 : 0, pitches_anonymised: scope.pitches.length, venues_anonymised: scope.venues.length, findings: scope.findings.length,
    alert_deliveries: scope.deliveries, offers: scope.offers.length, ledger_entries: scope.entries.length, sent_to_seeds: scope.sent.length,
    agent_records: residue.agent_records, refusal_records: residue.refusal_records, import_records: 0 }
  // The audit names the kind of person, the counts and references, never who they were.
  const audited = deletion_requests.map(({ ledger_id, network, outcome }) => ({ ledger_id, network, outcome }))
  const sent_to_seeds = scope.sent.map(sent => ({ ...sent, outcome: 'manual' as const }))
  statements.push(sql('INSERT INTO stump_erasures(id,kind,person_id,agent_id,counts,deletion_requests,sent_to_seeds,at) VALUES(?,?,?,?,?,?,?,?)',
    id, scope.subject.kind, ctx.person.id, ctx.agent?.id ?? null, JSON.stringify(counts), JSON.stringify(audited), JSON.stringify(sent_to_seeds), now))
  if (scope.contact && await holdsImports(db)) {
    // The list import's copies of the journalist leave in the same batch as everything above.
    const retired = await eraseWithImportCustody(ctx, id, { name: scope.contact.name, venueTargets: imported.map(venue => venue.target_id) }, statements, imported[0]?.target_id ?? null)
    counts.import_records = retired.recordsErased
    await db.prepare('UPDATE stump_erasures SET counts=? WHERE id=?').bind(JSON.stringify(counts), id).run()
  } else await db.batch(statements.map(statement => db.prepare(statement.sql).bind(...statement.params ?? [])))
  // A pitch's flags quote its sentences: checked again, they hold the text as it is now.
  await recheckItems(db, scope.pitches, now)
  ctx.emit('person.erased', `stump://erasures/${id}`, { kind: scope.subject.kind })
  return { erasure_id: id, kind: scope.subject.kind, removed: counts, deletion_requests, sent_to_seeds }
}
