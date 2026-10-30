// Erasure of a person outside the company (STUMP-DATA-002): a journalist by
// their press contact, or an engager by their handles. Their personal data
// leaves press contacts, pitches (which keep an anonymised reference),
// journalist venues, findings and their alerts, the inbox and offers to send
// them to Orbit. Each of the company's posts that names them is asked to be
// deleted at its network through that network's publisher, and the answer for
// each ledger entry comes back with its outcome; an entry under legal hold is
// kept and named as kept. The erasure is audited by counts and outcomes only.
import { xPrices } from '../accounts/apps.ts'
import { readAccount } from '../accounts/store.ts'
import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import { recordDeletion } from '../ledger/record.ts'
import { publishers } from '../publish/publishers.ts'
import { recheckItems } from './recheck.ts'
import type { PublishContext, Publisher } from '../publish/types.ts'

export type SubjectKind = 'journalist' | 'engager'
export interface Subject { kind: SubjectKind; contact_id: string | null; handles: string[] }

/** One of the company's ledger entries naming the person. */
interface Named { id: string; network: string | null; account_id: string | null; network_id: string | null; route: string; person_id: string | null; legal_hold: string | null }

/** What a delete request answered for one ledger entry. */
export interface DeletionRequest {
  ledger_id: string; network: string | null
  outcome: 'deleted' | 'not_found' | 'failed' | 'kept' | 'manual'
  /** Why a request failed, why an entry was kept (its legal hold), or who removes a hand-posted one. */
  error?: string; hold?: string; person_id?: string | null
}

/** The delete a publisher offers for one of the account's posts (the publishing lane's Publisher.remove). */
type Remove = (entry: { network: string; account_id: string; network_id: string }, ctx: PublishContext) => Promise<{ outcome: 'deleted' | 'not_found' | 'failed'; error?: string }>

/**
 * Other records holding an engager's data, each found and removed by handle:
 * one line per source. The inbox lane's items join here.
 */
export interface EngagerData {
  name: string
  count(db: D1Database, handles: string[]): Promise<number>
  remove(db: D1Database, handles: string[]): D1PreparedStatement[]
}
const ENGAGER_DATA: readonly EngagerData[] = []

/** A handle as it is written in posts and findings, without its leading '@', compared without case. */
const folded = (handle: string) => handle.trim().replace(/^@/, '').toLowerCase()
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function subjectOf(args: Args): Subject {
  const subject = args.subject as { kind?: unknown; contact_id?: unknown; handles?: unknown }
  if (subject.kind === 'journalist') {
    if (subject.handles !== undefined) refuse('invalid_arguments', { field: 'subject.handles', reason: 'A journalist is erased by their press contact.' })
    if (typeof subject.contact_id !== 'string') refuse('invalid_arguments', { field: 'subject.contact_id', reason: 'Name the journalist\'s press contact.' })
    return { kind: 'journalist', contact_id: subject.contact_id, handles: [] }
  }
  if (subject.contact_id !== undefined) refuse('invalid_arguments', { field: 'subject.contact_id', reason: 'An engager is erased by their handles.' })
  const handles = [...new Set((subject.handles as string[] | undefined ?? []).map(folded).filter(Boolean))]
  if (!handles.length) refuse('invalid_arguments', { field: 'subject.handles', reason: 'Name at least one of the engager\'s handles.' })
  return { kind: 'engager', contact_id: null, handles }
}

/** Every record the erasure touches, found before anything changes. */
export interface Scope {
  subject: Subject
  contact: { id: string; name: string } | null
  pitches: string[]
  venues: string[]
  findings: string[]
  deliveries: number
  offers: string[]
  /** Records in the other engager sources, by source name. */
  other: Record<string, number>
  entries: Named[]
}

/** A mention of a handle in a post: '@handle', or '@handle@instance' on Mastodon, not inside a longer handle. */
const mentionPattern = (handles: string[]) => new RegExp(`(^|[^\\w@.])@(${handles.map(escape).join('|')})(?![\\w-]|\\.\\w)`, 'i')
/** A post's address that belongs to the handle: x.com/<handle>/..., bsky.app/profile/<handle>/..., <instance>/@<handle>/... */
const addressPattern = (handles: string[]) => new RegExp(`^https?://[^/]+/(?:profile/|@)?(${handles.map(escape).join('|')})(?:/|$)`, 'i')
const namePattern = (name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'iu')

export async function scopeOf(ctx: ActionContext, subject: Subject): Promise<Scope> {
  const db = ctx.db
  const scope: Scope = { subject, contact: null, pitches: [], venues: [], findings: [], deliveries: 0, offers: [], other: {}, entries: [] }
  // The company's posts on the ledger that could name the person: what went out, published or handed off, and is not yet gone.
  const entries = (await db.prepare(`SELECT l.id,l.network,l.account_id,l.network_id,l.route,l.person_id,l.legal_hold,l.text,i.reply_to,i.recipient FROM stump_ledger l LEFT JOIN stump_items i ON i.id=l.item_id
    WHERE l.route IN ('published','handed_off') AND l.state IN ('posted','uncertain') ORDER BY l.posted_at,l.id`)
    .all<Named & { text: string | null; reply_to: string | null; recipient: string | null }>()).results
  let names: (entry: typeof entries[number]) => boolean
  if (subject.kind === 'journalist') {
    const contact = await db.prepare('SELECT id,name FROM stump_press_contacts WHERE id=?').bind(subject.contact_id).first<{ id: string; name: string }>()
    if (!contact) refuse('not_found', { contact_id: subject.contact_id })
    scope.contact = contact
    scope.pitches = (await db.prepare("SELECT id FROM stump_items WHERE json_extract(recipient,'$.contact_id')=? ORDER BY id").bind(contact.id).all<{ id: string }>()).results.map(row => row.id)
    scope.venues = (await db.prepare("SELECT id FROM stump_venues WHERE kind='journalist' AND lower(trim(name))=lower(trim(?)) ORDER BY id").bind(contact.name).all<{ id: string }>()).results.map(row => row.id)
    const named = namePattern(contact.name)
    names = entry => (entry.text !== null && named.test(entry.text)) || (entry.recipient !== null && (JSON.parse(entry.recipient) as { contact_id?: string }).contact_id === contact.id)
  } else {
    const mention = mentionPattern(subject.handles), address = addressPattern(subject.handles)
    const placeholders = subject.handles.map(() => '?').join(',')
    scope.findings = (await db.prepare(`SELECT id FROM stump_findings WHERE lower(ltrim(trim(author),'@')) IN (${placeholders}) ORDER BY id`).bind(...subject.handles).all<{ id: string }>()).results.map(row => row.id)
    if (scope.findings.length) {
      const ids = scope.findings.map(() => '?').join(',')
      scope.deliveries = (await db.prepare(`SELECT COUNT(*) AS n FROM stump_watch_deliveries WHERE finding_id IN (${ids})`).bind(...scope.findings).first<{ n: number }>())?.n ?? 0
    }
    scope.offers = (await db.prepare(`SELECT id FROM stump_stack_offers WHERE kind='engager' AND lower(ltrim(trim(handle),'@')) IN (${placeholders}) ORDER BY id`).bind(...subject.handles).all<{ id: string }>()).results.map(row => row.id)
    for (const source of ENGAGER_DATA) scope.other[source.name] = await source.count(db, subject.handles)
    names = entry => (entry.text !== null && mention.test(entry.text)) || (entry.reply_to !== null && address.test(String((JSON.parse(entry.reply_to) as { url?: string }).url ?? '')))
  }
  scope.entries = entries.filter(names).map(({ id, network, account_id, network_id, route, person_id, legal_hold }) => ({ id, network, account_id, network_id, route, person_id, legal_hold }))
  return scope
}

/** How many records leave Stump: the destructive measure of the call. */
export const removedCount = (scope: Scope) => (scope.contact ? 1 : 0) + scope.pitches.length + scope.venues.length + scope.findings.length + scope.offers.length
  + Object.values(scope.other).reduce((sum, count) => sum + count, 0)

/** Asks the network to delete one of the company's posts naming the person, through its publisher. */
async function requestDeletion(ctx: ActionContext, entry: Named): Promise<DeletionRequest> {
  const answer = { ledger_id: entry.id, network: entry.network }
  if (entry.legal_hold) return { ...answer, outcome: 'kept', hold: (JSON.parse(entry.legal_hold) as { reason?: string }).reason ?? 'legal hold' }
  // A hand-off was posted by the named member from their own account: they remove it by hand.
  if (entry.route === 'handed_off') return { ...answer, outcome: 'manual', person_id: entry.person_id }
  if (!entry.network || !entry.account_id || !entry.network_id) return { ...answer, outcome: 'failed', error: 'The entry has no network address to delete.' }
  const account = await readAccount(ctx.db, entry.account_id)
  if (!account) return { ...answer, outcome: 'failed', error: 'The account that posted it is no longer in Stump.' }
  const remove = (publishers[entry.network] as (Publisher & { remove?: Remove }) | undefined)?.remove
  if (!remove) return { ...answer, outcome: 'failed', error: `Stump has no delete for ${entry.network} posts.` }
  const result = await remove({ network: entry.network, account_id: entry.account_id, network_id: entry.network_id },
    { db: ctx.db, env: ctx.env, account, prices: await xPrices(ctx.db), now: ctx.now })
  return { ...answer, outcome: result.outcome, ...(result.error ? { error: result.error } : {}) }
}

export async function erase(ctx: ActionContext, scope: Scope) {
  const db = ctx.db, id = crypto.randomUUID(), actor = { person_id: ctx.person.id, agent_id: ctx.agent?.id ?? null }
  const deletion_requests: DeletionRequest[] = []
  for (const entry of scope.entries) {
    const request = await requestDeletion(ctx, entry)
    deletion_requests.push(request)
    if (request.outcome === 'deleted' || request.outcome === 'not_found') await db.batch(await recordDeletion(db, entry.id, request.outcome, actor, 'Erasure of a person named in it', ctx.now()))
  }

  const now = ctx.now(), statements: D1PreparedStatement[] = []
  const list = (ids: string[]) => ids.map(() => '?').join(',')
  if (scope.contact) {
    const name = scope.contact.name, reference = JSON.stringify({ contact_id: null, name: null, route: null, erased: `erasure:${id}` })
    // Pitches keep their text with the journalist's name taken out, and an anonymised reference in place of the contact.
    statements.push(db.prepare('DELETE FROM stump_press_contacts WHERE id=?').bind(scope.contact.id))
    for (const item of scope.pitches) {
      statements.push(
        db.prepare(`UPDATE stump_items SET recipient=json_patch(recipient,?),text=replace(text,?,'[name erased]'),subject=replace(subject,?,'[name erased]') WHERE id=?`).bind(reference, name, name, item),
        db.prepare("UPDATE stump_item_revisions SET text=replace(text,?,'[name erased]') WHERE item_id=?").bind(name, item))
    }
    for (const venue of scope.venues) {
      statements.push(db.prepare(`UPDATE stump_venues SET name=?,url=NULL,url_key=NULL,details='{}',audience=NULL,why=NULL,reader_value=NULL,notes=NULL,archived=1,archived_at=?,archived_by=?,
        revision=revision+1,updated_at=? WHERE id=?`).bind(`Erased journalist ${venue.slice(0, 8)}`, now, ctx.person.id, now, venue),
      db.prepare("DELETE FROM stump_venue_history WHERE venue_id=? AND action<>'erased'").bind(venue),
      db.prepare("INSERT INTO stump_venue_history(id,venue_id,action,person_id,agent_id,detail,at) VALUES(?,?,'erased',?,?,?,?)").bind(crypto.randomUUID(), venue, ctx.person.id, ctx.agent?.id ?? null, JSON.stringify({ erasure_id: id }), now))
    }
  }
  if (scope.findings.length) {
    statements.push(db.prepare(`DELETE FROM stump_watch_deliveries WHERE finding_id IN (${list(scope.findings)})`).bind(...scope.findings),
      db.prepare(`DELETE FROM stump_findings WHERE id IN (${list(scope.findings)})`).bind(...scope.findings))
  }
  if (scope.offers.length) statements.push(db.prepare(`DELETE FROM stump_stack_offers WHERE id IN (${list(scope.offers)})`).bind(...scope.offers))
  if (scope.subject.kind === 'engager') for (const source of ENGAGER_DATA) statements.push(...source.remove(db, scope.subject.handles))
  const counts = { ...scope.other, press_contacts: scope.contact ? 1 : 0, pitches_anonymised: scope.pitches.length, venues_anonymised: scope.venues.length, findings: scope.findings.length,
    alert_deliveries: scope.deliveries, offers: scope.offers.length, ledger_entries: scope.entries.length }
  // The audit names the kind of person and the counts, never who they were.
  const audited = deletion_requests.map(({ ledger_id, network, outcome }) => ({ ledger_id, network, outcome }))
  statements.push(db.prepare('INSERT INTO stump_erasures(id,kind,person_id,agent_id,counts,deletion_requests,at) VALUES(?,?,?,?,?,?,?)')
    .bind(id, scope.subject.kind, ctx.person.id, ctx.agent?.id ?? null, JSON.stringify(counts), JSON.stringify(audited), now))
  await db.batch(statements)
  // A pitch's flags quote its sentences: checked again, they hold the text as it is now.
  await recheckItems(db, scope.pitches, now)
  ctx.emit('person.erased', `stump://erasures/${id}`, { kind: scope.subject.kind })
  return { erasure_id: id, kind: scope.subject.kind, removed: counts, deletion_requests }
}
