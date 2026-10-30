// Creating and saving items: every write makes a revision, runs the draft
// check and stores its flags (the draft-check data contract). A near-duplicate
// is held until rewritten (STUMP-TRUTH-004); a save to an item that was ready,
// scheduled or paused returns it to draft, so a new revision needs a new
// approval and the old one never posts (STUMP-SURFACE-009, D-2).
import { refuse } from '../actions/refusals.ts'
import type { ActionContext } from '../actions/types.ts'
import { TRANSITIONS, type ItemState } from '../items/state.ts'
import { readPerson } from '../people/store.ts'
import { checkDraft, loadBrand, type Brand, type CheckResult, type Draft } from './check.ts'
import { itemRecord, parse, type Row } from './records.ts'

export const NOT_EDITABLE: readonly ItemState[] = ['posting', 'posted', 'partly_posted', 'uncertain', 'cancelled']

export async function readItem(ctx: Pick<ActionContext, 'db' | 'person'>, id: unknown): Promise<Row> {
  const row = await ctx.db.prepare('SELECT * FROM stump_items WHERE id=?').bind(String(id)).first<Row>()
  // A poster sees only their own items (STUMP-TEAM-001.2).
  if (!row || ctx.person.role === 'poster' && row.person_id !== ctx.person.id) refuse('not_found', { item_id: String(id) })
  return row
}

/** Contributors write their own items; editors and above write anyone's. */
export function mayWrite(ctx: Pick<ActionContext, 'person'>, personId: unknown) {
  if (['owner', 'admin', 'editor'].includes(ctx.person.role)) return
  if (ctx.person.role === 'contributor' && personId === ctx.person.id) return
  refuse('forbidden', { role: ctx.person.role, person_id: String(personId) })
}

/** The state an item moves to after a check: held while it nearly repeats something, back to draft once rewritten. */
function nextState(current: ItemState, check: CheckResult, saved: boolean): ItemState {
  if (check.duplicates.length) return 'held'
  if (current === 'held') return 'draft'
  return saved && ['ready', 'scheduled', 'paused', 'failed'].includes(current) ? 'draft' : current
}
const holdFor = (check: CheckResult, ownerId: string) => check.duplicates.length
  ? JSON.stringify({ owner_id: ownerId, reason: 'near_duplicate', detail: `Nearly repeats ${check.duplicates.map(match => `${match.kind} ${match.id}`).join(', ')}. Rewrite it to clear the hold.`, matches: check.duplicates, next_attempt_at: null })
  : null

export interface NewItem extends Draft {
  id: string; sources?: unknown[]; ai?: unknown; recipient?: unknown; subject?: string | null; reply_to?: unknown; campaign?: string | null
  options?: Record<string, unknown>; differs_from_master?: 0 | 1
}

/** Statements that insert one new item at revision 1 with its check, and the check itself. */
export async function prepareInsert(ctx: ActionContext, brand: Brand, item: NewItem): Promise<{ statements: D1PreparedStatement[]; check: CheckResult; state: ItemState }> {
  const person = await readPerson(ctx.db, item.person_id), now = ctx.now()
  const check = await checkDraft(ctx.db, brand, item, person, now)
  const state = nextState('draft', check, false)
  const agent = ctx.agent ? JSON.stringify({ id: ctx.agent.id, name: ctx.agent.name }) : null
  return {
    check, state,
    statements: [
      ctx.db.prepare(`INSERT INTO stump_items(id,format,network,account_id,venue_id,person_id,product_id,master_id,state,revision,text,parts,flags,claims_used,sources,ai,
        hold,recipient,subject,reply_to,differs_from_master,campaign,options,agent,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(item.id, item.format, item.network, item.account_id, item.venue_id, item.person_id, item.product_id, item.master_id, state, item.parts?.length ? null : item.text,
          item.parts?.length ? JSON.stringify(item.parts) : null, JSON.stringify(check.flags), JSON.stringify(check.claims_used), JSON.stringify(item.sources ?? []),
          item.ai ? JSON.stringify(item.ai) : null, holdFor(check, item.person_id), item.recipient ? JSON.stringify(item.recipient) : null, item.subject ?? null,
          item.reply_to ? JSON.stringify(item.reply_to) : null, item.differs_from_master ?? 0, item.campaign ?? null, JSON.stringify(item.options ?? {}), agent, ctx.person.id, now, now),
      ctx.db.prepare('INSERT INTO stump_item_revisions(item_id,revision,text,parts,saved_by,agent_id,at) VALUES(?,1,?,?,?,?,?)')
        .bind(item.id, item.parts?.length ? null : item.text, item.parts?.length ? JSON.stringify(item.parts) : null, ctx.person.id, ctx.agent?.id ?? null, now),
      ctx.db.prepare("INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,agent_id,reason,at) VALUES(?,?,NULL,?,?,?,?,?)")
        .bind(crypto.randomUUID(), item.id, state, ctx.person.id, ctx.agent?.id ?? null, state === 'held' ? 'near_duplicate' : 'drafted', now),
    ],
  }
}

/** Inserts items in one batch, after any statements they depend on (a master row). */
export async function insertItems(ctx: ActionContext, items: NewItem[], before: D1PreparedStatement[] = []) {
  const brand = await loadBrand(ctx.db), statements: D1PreparedStatement[] = [...before], checks: CheckResult[] = []
  for (const item of items) { const prepared = await prepareInsert(ctx, brand, item); statements.push(...prepared.statements); checks.push(prepared.check) }
  await ctx.db.batch(statements)
  for (const item of items) ctx.emit('item.drafted', `stump://items/${item.id}`)
  return checks
}

/**
 * Statements that save new text as the next revision of a row, guarded by the
 * revision read, with the check stored and the state it moves to recorded.
 */
export async function prepareSave(ctx: ActionContext, brand: Brand, row: Row, next: { text: string | null; parts: string[] | null; differs_from_master?: 0 | 1 }, reason: string) {
  const current = row.state as ItemState
  if (NOT_EDITABLE.includes(current)) refuse('not_editable', { item_id: row.id, state: current })
  const draft: Draft = { id: String(row.id), format: String(row.format), network: row.network as string | null, account_id: row.account_id as string | null,
    venue_id: row.venue_id as string | null, person_id: String(row.person_id), product_id: row.product_id as string | null, master_id: row.master_id as string | null, ...next }
  const person = await readPerson(ctx.db, draft.person_id), now = ctx.now()
  const check = await checkDraft(ctx.db, brand, draft, person, now)
  const state = nextState(current, check, true)
  if (state !== current && !TRANSITIONS[current].includes(state)) refuse('not_editable', { item_id: row.id, state: current })
  const revision = Number(row.revision) + 1
  const text = next.parts?.length ? null : next.text, parts = next.parts?.length ? JSON.stringify(next.parts) : null
  const unscheduled = state !== current && ['scheduled', 'paused'].includes(current)
  const statements = [
    ctx.db.prepare(`UPDATE stump_items SET text=?,parts=?,flags=?,claims_used=?,state=?,revision=?,hold=?,differs_from_master=?,
      scheduled_at=CASE WHEN ? THEN NULL ELSE scheduled_at END,approved_by=NULL,updated_at=? WHERE id=? AND revision=?`)
      .bind(text, parts, JSON.stringify(check.flags), JSON.stringify(check.claims_used), state, revision, holdFor(check, draft.person_id),
        next.differs_from_master ?? Number(row.differs_from_master ?? 0), unscheduled ? 1 : 0, now, row.id, row.revision),
    ctx.db.prepare('INSERT INTO stump_item_revisions(item_id,revision,text,parts,saved_by,agent_id,at) SELECT ?,?,?,?,?,?,? WHERE changes()=1')
      .bind(row.id, revision, text, parts, ctx.person.id, ctx.agent?.id ?? null, now),
    ...(state !== current ? [ctx.db.prepare(`INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,agent_id,reason,at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM stump_item_revisions WHERE item_id=? AND revision=? AND at=?)`)
      .bind(crypto.randomUUID(), row.id, current, state, ctx.person.id, ctx.agent?.id ?? null, state === 'held' ? 'near_duplicate' : reason, now, row.id, revision, now)] : []),
  ]
  return { statements, check, state, revision }
}

/** Saves one item and answers its record, or revision_conflict when it changed since it was read. */
export async function saveItem(ctx: ActionContext, row: Row, next: { text: string | null; parts: string[] | null; differs_from_master?: 0 | 1 }, reason: string) {
  const brand = await loadBrand(ctx.db)
  const saved = await prepareSave(ctx, brand, row, next, reason)
  const [update] = await ctx.db.batch(saved.statements)
  if (!update!.meta.changes) {
    const now = await ctx.db.prepare('SELECT revision FROM stump_items WHERE id=?').bind(row.id).first<{ revision: number }>()
    refuse('revision_conflict', { current_revision: now?.revision ?? null })
  }
  ctx.emit('item.saved', `stump://items/${String(row.id)}`, { revision: saved.revision })
  return { item: await itemView(ctx.db, String(row.id)), check: saved.check }
}

/** An item with its history and media, as get answers it. */
export async function itemView(db: D1Database, id: string) {
  const [items, history, media, revisions] = await db.batch([
    db.prepare('SELECT * FROM stump_items WHERE id=?').bind(id),
    db.prepare('SELECT from_state,to_state,person_id,agent_id,reason,at FROM stump_item_history WHERE item_id=? ORDER BY at,id').bind(id),
    db.prepare('SELECT id,name,type,size,alt FROM stump_media WHERE item_id=? ORDER BY created_at,id').bind(id),
    db.prepare('SELECT revision,saved_by,agent_id,at FROM stump_item_revisions WHERE item_id=? ORDER BY revision').bind(id),
  ])
  const row = (items!.results as Row[])[0]
  if (!row) refuse('not_found', { item_id: id })
  return {
    ...itemRecord(row),
    history: (history!.results as Row[]).map(entry => ({ from: entry.from_state, to: entry.to_state, person_id: entry.person_id, agent_id: entry.agent_id, reason: entry.reason, at: new Date(Number(entry.at)).toISOString() })),
    media: media!.results,
    revisions: (revisions!.results as Row[]).map(entry => ({ revision: Number(entry.revision), saved_by: entry.saved_by, agent_id: entry.agent_id, at: new Date(Number(entry.at)).toISOString() })),
  }
}

/** One revision's text and parts. */
export async function readRevision(db: D1Database, itemId: string, revision: number) {
  const row = await db.prepare('SELECT text,parts FROM stump_item_revisions WHERE item_id=? AND revision=?').bind(itemId, revision).first<Row>()
  if (!row) refuse('not_found', { item_id: itemId, revision })
  return { text: (row.text as string | null) ?? null, parts: parse<string[] | null>(row.parts, null) }
}
