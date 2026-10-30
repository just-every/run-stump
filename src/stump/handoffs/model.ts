// A hand-off as D1 holds it and as both doors answer it (V1 "Records":
// Hand-off), with its history. States: open join_first held posted skipped expired.
import { refuse } from '../actions/refusals.ts'
import type { ActionContext } from '../actions/types.ts'
import { rulesOf, type VenueRow } from '../venues/model.ts'

export const STATES = ['open', 'join_first', 'held', 'posted', 'skipped', 'expired'] as const
export type HandoffState = typeof STATES[number]
/** States that still wait on the named person. */
export const ACTIVE: readonly HandoffState[] = ['open', 'join_first', 'held']
export const LAPSES = ['expire', 'reassign', 'next_slot'] as const
export type Lapse = typeof LAPSES[number]

export interface Fact { claim_id: string; text: string; proof: unknown }
/** Who holds a hand-off and why: a person until a review date, or a venue rule until it no longer applies. */
export interface Hold {
  kind: 'person' | 'rule'; reason: string; by: string | null; by_name: string | null; agent: { id: string; name: string } | null
  review_at: string | null; rule: string | null; source_url: string | null; at: string
  /** A shared-limit hold: when the venue next has room. */
  next_open_at?: string | null
  /** A near-duplicate hold (STUMP-TRUTH-004): the ledger entries and queued items the draft nearly repeats. */
  matches?: Array<{ id: string; kind: 'item' | 'ledger'; score: number; url: string | null; handoff_id?: string }>
}

export interface HandoffRow {
  id: string; item_id: string | null; venue_id: string; person_id: string; product_id: string | null; state: HandoffState; due_at: number | null
  lapse: Lapse | null; rules: string; facts: string; disclosure_line: string | null; draft_text: string | null; talking_points: string; own_words: string | null
  own_words_required: number; attestation_required: number; join_steps: string; next_open_at: number | null; hold: string | null; thread_url: string | null
  url: string | null; ledger_id: string | null; campaign: string | null; agent: string | null; revision: number; created_by: string; created_at: number; updated_at: number
  route: 'handoff_draft' | 'handoff_brief' | null; recommends: number; confirmation: 'network' | 'person' | null; posted_at: number | null; attested_at: number | null
}

/** Whoever moves a hand-off: a person (and their agent), or the scheduled tick with neither. */
export interface Actor { db: D1Database; person: { id: string } | null; agent: { id: string; name?: string } | null; now(): number }

const json = <T,>(value: string | null, fallback: T): T => value === null ? fallback : JSON.parse(value) as T
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString()

export const readHandoff = (db: D1Database, id: unknown) => typeof id === 'string' ? db.prepare('SELECT * FROM stump_handoffs WHERE id=?').bind(id).first<HandoffRow>() : Promise.resolve(null)

/** The hand-off a person may see: a poster sees only their own (STUMP-TEAM-001.2, STUMP-HANDOFF-001.6). */
export async function handoffOrRefuse(ctx: Pick<ActionContext, 'db' | 'person'>, id: unknown): Promise<HandoffRow> {
  const row = await readHandoff(ctx.db, id)
  if (!row || (ctx.person.role === 'poster' && row.person_id !== ctx.person.id)) refuse('not_found', { handoff_id: String(id) })
  return row
}

/** One history row: what happened, the states either side, who did it and the facts of it. */
export function history(actor: Actor, handoffId: string, action: string, from: HandoffState | null, to: HandoffState | null, detail: Record<string, unknown> = {}) {
  return actor.db.prepare('INSERT INTO stump_handoff_history(id,handoff_id,action,from_state,to_state,person_id,agent_id,detail,at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), handoffId, action, from, to, actor.person?.id ?? null, actor.agent?.id ?? null, JSON.stringify(detail), actor.now())
}

/**
 * Moves a hand-off from the state it was read in, with its history, guarded by
 * that state and revision so a move made meanwhile wins. Extra columns are set
 * in the same write.
 */
export function move(actor: Actor, row: Pick<HandoffRow, 'id' | 'state' | 'revision'>, to: HandoffState, action: string, set: Record<string, unknown> = {}, detail: Record<string, unknown> = {}): D1PreparedStatement[] {
  const columns = Object.keys(set)
  if (columns.some(column => !/^[a-z_]+$/.test(column))) throw new Error('Invalid hand-off column')
  const assignments = ['state=?', 'revision=revision+1', 'updated_at=?', ...columns.map(column => `${column}=?`)].join(',')
  return [
    actor.db.prepare(`UPDATE stump_handoffs SET ${assignments} WHERE id=? AND state=? AND revision=?`).bind(to, actor.now(), ...columns.map(column => set[column]), row.id, row.state, row.revision),
    actor.db.prepare(`INSERT INTO stump_handoff_history(id,handoff_id,action,from_state,to_state,person_id,agent_id,detail,at) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1`)
      .bind(crypto.randomUUID(), row.id, action, row.state, to, actor.person?.id ?? null, actor.agent?.id ?? null, JSON.stringify(detail), actor.now()),
  ]
}

interface HistoryRow { action: string; from_state: string | null; to_state: string | null; person_id: string | null; agent_id: string | null; detail: string; at: number }

/** The hand-off as both doors answer it: the venue's rules as they read now, the facts, the brief or draft, the hold and its history. */
export function handoffRecord(row: HandoffRow, venue: VenueRow, extra: { person_name: string | null; history: HistoryRow[]; flags: unknown[]; draft_text: string | null }) {
  const howTo = json<Record<string, unknown>>(venue.how_to_post, {})
  return {
    id: row.id, venue_id: row.venue_id, venue: { id: venue.id, name: venue.name, url: venue.url, kind: venue.kind, platform: venue.platform, how_to_post: howTo },
    person_id: row.person_id, person_name: extra.person_name, product_id: row.product_id, item_id: row.item_id, state: row.state, route: row.route,
    due_at: iso(row.due_at), lapse: row.lapse, rules: rulesOf(venue), why: venue.why, thread_url: row.thread_url,
    facts: json<Fact[]>(row.facts, []), disclosure_line: row.disclosure_line, draft_text: extra.draft_text, talking_points: json<string[]>(row.talking_points, []),
    own_words: row.own_words, own_words_required: extra.draft_text === null, attestation_required: row.attestation_required === 1, recommends: row.recommends === 1,
    join_steps: json<string[]>(row.join_steps, []), next_open_at: iso(row.next_open_at), hold: json<Hold | null>(row.hold, null), flags: extra.flags,
    url: row.url, ledger_id: row.ledger_id, confirmation: row.confirmation, posted_at: iso(row.posted_at), attested_at: iso(row.attested_at),
    campaign: row.campaign, agent: json<{ id: string; name: string } | null>(row.agent, null), revision: row.revision,
    created_at: iso(row.created_at), updated_at: iso(row.updated_at),
    history: extra.history.map(entry => ({ action: entry.action, from: entry.from_state, to: entry.to_state, person_id: entry.person_id, agent_id: entry.agent_id,
      detail: JSON.parse(entry.detail) as Record<string, unknown>, at: new Date(entry.at).toISOString() })),
  }
}
export type HandoffRecord = ReturnType<typeof handoffRecord>

export async function historyOf(db: D1Database, ids: string[]): Promise<Map<string, HistoryRow[]>> {
  const out = new Map<string, HistoryRow[]>(ids.map(id => [id, []]))
  if (!ids.length) return out
  const rows = (await db.prepare(`SELECT handoff_id,action,from_state,to_state,person_id,agent_id,detail,at FROM stump_handoff_history
    WHERE handoff_id IN (SELECT value FROM json_each(?)) ORDER BY at,rowid`).bind(JSON.stringify(ids)).all<HistoryRow & { handoff_id: string }>()).results
  for (const row of rows) out.get(row.handoff_id)!.push(row)
  return out
}
