// The one writer of the ledger (STUMP-LEDGER-001): every posted, failed and
// uncertain publish outcome, with "<agent> for <person>", the text read back
// from the network, the revision that went out and its charge. An item has one
// published entry per account; a later outcome for it keeps the earlier one as
// a version, so nothing on the record is lost (append-only). Hand-offs, the inbox
// and data write their entries through recordEntry; the posting path annotates a
// posted entry in Vane through annotatePosted.
import type { StumpEnv } from '../env.ts'
import { annotateLedgerEntry } from '../stack/index.ts'

export interface LedgerItem {
  id: string; network: string | null; account_id: string | null; person_id: string; venue_id: string | null; product_id: string | null; campaign: string | null
  claims_used: string; revision: number; text: string | null; parts: string | null; agent: string | null; scheduled_by: string | null; approved_by: string | null
}

export type LedgerOutcome =
  | { state: 'posted'; url: string; network_id: string; text: string; posted_at: number }
  | { state: 'failed' | 'uncertain'; url: string | null; network_id: string | null; error: { code: string; message: string }; hold?: { owner_id: string; reason: string } | null }

type Agent = { id: string; name: string }
const parse = <T>(value: string | null): T | null => value ? JSON.parse(value) as T : null

/** The agent behind an outcome: the one that published it, else the one that drafted it. */
function agentOf(item: LedgerItem): Agent | null {
  return parse<{ agent?: Agent | null }>(item.scheduled_by)?.agent ?? parse<Agent>(item.agent)
}

const attempted = (item: LedgerItem) => item.parts ? (JSON.parse(item.parts) as string[]).join('\n\n') : item.text

export async function recordOutcome(db: D1Database, item: LedgerItem, outcome: LedgerOutcome, now: number): Promise<D1PreparedStatement[]> {
  const agent = agentOf(item), by = await byLabel(db, item.person_id, agent)
  const scheduled = parse<{ approved_by?: Array<{ id: string; name: string }> }>(item.scheduled_by)
  const approved = scheduled?.approved_by?.length ? JSON.stringify(scheduled.approved_by) : item.approved_by
  // X charges each post from the company's price table; the entry carries what this item's posts cost.
  const charge = item.network === 'x'
    ? ((await db.prepare("SELECT COALESCE(SUM(usd_micro),0) AS micro FROM stump_network_calls WHERE item_id=? AND account_id=? AND act IN ('post','post_with_url')")
      .bind(item.id, item.account_id).first<{ micro: number }>())?.micro ?? 0) / 1e6
    : null
  const fields = outcome.state === 'posted'
    ? { url: outcome.url, network_id: outcome.network_id, text: outcome.text, posted_at: outcome.posted_at, confirmation: 'network', hold: null }
    : { url: outcome.url, network_id: outcome.network_id, text: attempted(item), posted_at: null, confirmation: null,
      hold: outcome.state === 'uncertain' && outcome.hold ? JSON.stringify({ ...outcome.hold, error: outcome.error }) : JSON.stringify({ error: outcome.error }) }
  const existing = await db.prepare("SELECT * FROM stump_ledger WHERE item_id=? AND account_id=? AND route='published'").bind(item.id, item.account_id).first<Record<string, unknown>>()
  if (!existing) {
    return [db.prepare(`INSERT INTO stump_ledger(id,item_id,url,network,network_id,venue_id,account_id,person_id,agent,by_label,text,claims,product_id,campaign,route,state,
      confirmation,revision,posted_at,charge_usd,approved_by,hold,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), item.id, fields.url, item.network, fields.network_id, item.venue_id, item.account_id, item.person_id, agent ? JSON.stringify(agent) : null, by,
        fields.text, item.claims_used, item.product_id, item.campaign, outcome.state, fields.confirmation, item.revision, fields.posted_at, charge, approved, fields.hold, now, now)]
  }
  const previous = { state: existing.state, url: existing.url, network_id: existing.network_id, text: existing.text, revision: existing.revision, posted_at: existing.posted_at,
    charge_usd: existing.charge_usd, hold: parse(existing.hold as string | null), by: existing.by_label }
  return [
    db.prepare('INSERT INTO stump_ledger_versions(id,entry_id,text,note,fields,person_id,agent_id,at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), existing.id, existing.text, `outcome ${String(existing.state)} then ${outcome.state}`, JSON.stringify(previous), item.person_id, agent?.id ?? null, now),
    db.prepare(`UPDATE stump_ledger SET url=?,network_id=?,agent=?,by_label=?,text=?,state=?,confirmation=?,revision=?,posted_at=?,charge_usd=?,approved_by=?,hold=?,updated_at=? WHERE id=?`)
      .bind(fields.url, fields.network_id, agent ? JSON.stringify(agent) : null, by, fields.text, outcome.state, fields.confirmation, item.revision, fields.posted_at, charge, approved, fields.hold, now, existing.id),
  ]
}

/** "<agent> for <person>" for an agent's work, the person's name otherwise. */
async function byLabel(db: D1Database, personId: string, agent: Agent | null) {
  const person = await db.prepare('SELECT display_name FROM stump_people WHERE id=?').bind(personId).first<{ display_name: string }>()
  const name = person?.display_name ?? personId
  return agent ? `${agent.name} for ${name}` : name
}

/** One entry on the record for work that did not go out through a publisher. */
export interface EntryInput {
  route: 'published' | 'handed_off' | 'orbit' | 'mango'
  state: 'posted' | 'failed' | 'uncertain'
  /** Who confirmed it went out: the network (read back) or the person who posted it by hand. */
  confirmation: 'network' | 'person' | null
  person_id: string
  agent: Agent | null
  /** The address and text as read back from where it was posted. */
  url: string | null
  text: string | null
  network: string | null
  network_id?: string | null
  venue_id?: string | null
  account_id?: string | null
  item_id?: string | null
  handoff_id?: string | null
  disclosure_line?: string | null
  claims?: unknown[]
  product_id?: string | null
  campaign?: string | null
  revision?: number | null
  posted_at: number | null
  approved_by?: unknown[] | null
}

/**
 * Writes one ledger entry (STUMP-LEDGER-001) and answers its id with the
 * statement, so the caller commits it in the same batch as its own change.
 */
export async function recordEntry(db: D1Database, input: EntryInput, now: number): Promise<{ id: string; statements: D1PreparedStatement[] }> {
  const id = crypto.randomUUID()
  return {
    id,
    statements: [db.prepare(`INSERT INTO stump_ledger(id,item_id,handoff_id,url,network,network_id,venue_id,account_id,person_id,agent,by_label,text,disclosure_line,claims,product_id,campaign,
      route,state,confirmation,revision,posted_at,charge_usd,approved_by,hold,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)`)
      .bind(id, input.item_id ?? null, input.handoff_id ?? null, input.url, input.network, input.network_id ?? null, input.venue_id ?? null, input.account_id ?? null, input.person_id,
        input.agent ? JSON.stringify(input.agent) : null, await byLabel(db, input.person_id, input.agent), input.text, input.disclosure_line ?? null, JSON.stringify(input.claims ?? []),
        input.product_id ?? null, input.campaign ?? null, input.route, input.state, input.confirmation, input.revision ?? null, input.posted_at,
        input.approved_by?.length ? JSON.stringify(input.approved_by) : null, now, now)],
  }
}

/**
 * Annotates a posted entry in Vane (STUMP-STACK-004) and records what Vane
 * answered on the entry: sent, failed with its error, or waiting while Vane is
 * not connected. A failure never blocks or undoes the post.
 */
export async function annotatePosted(env: StumpEnv, entryId: string, now = Date.now()): Promise<void> {
  const at = new Date(now).toISOString()
  let annotation: Record<string, unknown>
  try {
    const sent = await annotateLedgerEntry(env, entryId, null, now)
    annotation = sent.status === 'sent' || sent.status === 'already_sent' ? { status: 'sent', at, offer_id: sent.offer.id }
      : sent.status === 'failed' ? { status: 'failed', at, offer_id: sent.offer.id, error: sent.outcome.error ?? 'Vane refused the annotation.' }
      : sent.status === 'not_connected' ? { status: 'not_connected', at, offer_id: sent.offer.id }
      : { status: sent.status, at, ...(sent.status === 'skipped' ? { reason: sent.reason } : {}) }
  } catch (error) {
    annotation = { status: 'failed', at, error: error instanceof Error ? error.message : 'The annotation could not be sent.' }
  }
  await env.DB.prepare('UPDATE stump_ledger SET annotation=? WHERE id=?').bind(JSON.stringify(annotation), entryId).run()
}
