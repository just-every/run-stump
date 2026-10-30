// stump.handoffs.manage: the named person works their queue (STUMP-HANDOFF-001.6,
// .7, STUMP-HANDOFF-003.3): read it, edit the draft, skip with a reason, hold until
// a review date, release a hold.
import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import { saveItem } from '../drafting/items.ts'
import { moveItem, type ItemState } from '../items/state.ts'
import { readVenue } from '../venues/model.ts'
import { handoffEligibility } from '../venues/members.ts'
import { ACTIVE, handoffOrRefuse, move, type HandoffRow, type Hold } from './model.ts'
import { disclosureKept } from './disclosure.ts'
import { duplicateHold, limitHold, ruleHold, ruleHoldJson } from './holds.ts'
import { refreshed } from './refresh.ts'
import { one, records } from './view.ts'

const actorOf = (ctx: ActionContext) => ({ db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now })

/** The named person (or their agent) works a hand-off; editors and above work anyone's. */
async function working(ctx: ActionContext, id: unknown): Promise<HandoffRow> {
  const read = await handoffOrRefuse(ctx, id)
  if (read.person_id !== ctx.person.id && !['owner', 'admin', 'editor'].includes(ctx.person.role)) refuse('forbidden', { handoff_id: read.id, role: ctx.person.role, reason: 'Only the named person, or an editor, works this hand-off.' })
  const [row] = await refreshed(actorOf(ctx), [read])
  return row!
}

const changed = async (ctx: ActionContext, statements: D1PreparedStatement[], row: HandoffRow) => {
  const [update] = await ctx.db.batch(statements)
  if (!update!.meta.changes) refuse('revision_conflict', { handoff_id: row.id })
  ctx.emit('handoff.changed', `stump://handoffs/${row.id}`)
  return one(ctx, row.id)
}

export async function get(args: Args, ctx: ActionContext) {
  const [row] = await refreshed(actorOf(ctx), [await handoffOrRefuse(ctx, args.handoff_id)])
  return one(ctx, row!.id)
}

/** The caller's own hand-offs first, then everyone else's (none for a poster): waiting ones by due date, then done ones, newest first. */
export async function queue(ctx: ActionContext) {
  const only = ctx.person.role === 'poster' ? ctx.person.id : null
  const rows = (await ctx.db.prepare(`SELECT * FROM stump_handoffs WHERE (?1 IS NULL OR person_id=?1)
    ORDER BY person_id=?2 DESC, state IN ('open','join_first','held') DESC, CASE WHEN state IN ('open','join_first','held') THEN due_at END, updated_at DESC, id`)
    .bind(only, ctx.person.id).all<HandoffRow>()).results
  const fresh = await refreshed(actorOf(ctx), rows)
  const items = await records(ctx, fresh)
  return { items, total: items.length, mine: items.filter(item => item.person_id === ctx.person.id).length }
}

export async function edit(args: Args, ctx: ActionContext) {
  const row = await working(ctx, args.handoff_id)
  if (!ACTIVE.includes(row.state)) refuse('not_editable', { handoff_id: row.id, state: row.state })
  const item = row.item_id ? await ctx.db.prepare('SELECT * FROM stump_items WHERE id=?').bind(row.item_id).first<Record<string, unknown>>() : null
  if (row.route !== 'handoff_draft' || !item) {
    refuse('no_draft', { handoff_id: row.id, rule: row.attestation_required === 1 ? 'D-8' : row.route === 'handoff_brief' ? 'ai_text' : 'own_words',
      reason: 'This hand-off takes the person\'s own words: they write them when they record the link.' })
  }
  const text = String(args.draft_text)
  const venue = (await readVenue(ctx.db, row.venue_id))!
  // STUMP-HANDOFF-001.4: the disclosure stays in a draft that names the product, and its line stays in the draft.
  await disclosureKept(ctx.db, row, venue, String(item!.text ?? row.draft_text ?? ''), text, ctx.now())
  const saved = await saveItem(ctx, item!, { text, parts: null }, 'edited in the hand-off')
  // The edited text is read against the venue's rules again: a link where links are banned holds it, naming the rule. A draft that still
  // nearly repeats a queued or posted one stays held with its matches; a rewrite that clears the check's flag releases it (STUMP-TRUTH-004).
  const current = row.hold ? JSON.parse(row.hold) as Hold : null
  const ruleHeld = row.state === 'held' && current?.kind === 'rule' && current.rule !== 'shared_limit'
  const found = ruleHold(venue, { draft_text: text, thread_url: row.thread_url }) ?? duplicateHold(saved.check.flags)
  // A hold that clears lands the hand-off back in its period, which the shared limit may have filled meanwhile.
  const hold = found ?? (ruleHeld && row.due_at !== null ? await limitHold(ctx.db, venue, row.due_at, row.id) : null)
  const cleared = !hold && ruleHeld
  const to = hold ? 'held' : cleared ? (await handoffEligibility(ctx.db, venue, row.person_id, ctx.now())).join_first ? 'join_first' : 'open' : row.state
  const set = { draft_text: saved.item.text, ...(hold ? { hold: ruleHoldJson(hold, ctx.now()) } : cleared ? { hold: null } : {}) }
  return changed(ctx, move(actorOf(ctx), row, to, 'edited', set, { item_revision: saved.item.revision,
    ...(hold ? { rule: hold.rule, reason: hold.reason, ...(hold.matches ? { matches: hold.matches } : {}) } : cleared ? { cleared: current!.rule } : {}) }), row)
}

async function supersede(ctx: ActionContext, row: HandoffRow, reason: string) {
  if (!row.item_id) return []
  const item = await ctx.db.prepare('SELECT id,state FROM stump_items WHERE id=?').bind(row.item_id).first<{ id: string; state: ItemState }>()
  return item && ['draft', 'ready', 'held'].includes(item.state) ? moveItem(actorOf(ctx), item, 'cancelled', reason) : []
}

/** STUMP-HANDOFF-001.7: skipping records the reason, frees the shared-limit place and supersedes the draft. */
export async function skip(args: Args, ctx: ActionContext) {
  const row = await working(ctx, args.handoff_id)
  if (!ACTIVE.includes(row.state)) refuse('not_open', { handoff_id: row.id, state: row.state })
  const reason = String(args.reason).trim()
  const draft = await supersede(ctx, row, `The hand-off was skipped: ${reason}`)
  return changed(ctx, [...move(actorOf(ctx), row, 'skipped', 'skipped', { hold: null }, { reason, ...(draft.length ? { item_id: row.item_id, draft: 'superseded' } : {}) }), ...draft], row)
}

/** STUMP-HANDOFF-003.3: a held hand-off shows who holds it, why, and its review date, when its lapse action runs. */
export async function hold(args: Args, ctx: ActionContext) {
  const row = await working(ctx, args.handoff_id)
  if (row.state !== 'open' && row.state !== 'join_first') refuse('not_open', { handoff_id: row.id, state: row.state })
  const review = Date.parse(String(args.review_at))
  if (!Number.isFinite(review) || review <= ctx.now()) refuse('invalid_arguments', { field: 'review_at', reason: 'Give a review date in the future.' })
  const value: Hold = { kind: 'person', reason: String(args.reason).trim(), by: ctx.person.id, by_name: ctx.person.display_name, agent: ctx.agent ? { id: ctx.agent.id, name: ctx.agent.name } : null,
    review_at: new Date(review).toISOString(), rule: null, source_url: null, at: new Date(ctx.now()).toISOString() }
  return changed(ctx, move(actorOf(ctx), row, 'held', 'held', { hold: JSON.stringify(value) }, { reason: value.reason, review_at: value.review_at }), row)
}

/** Releases a person's hold; a hold a venue rule keeps stays until the rule no longer applies. */
export async function release(args: Args, ctx: ActionContext) {
  const row = await working(ctx, args.handoff_id)
  if (row.state !== 'held') refuse('not_held', { handoff_id: row.id, state: row.state })
  const current = JSON.parse(row.hold!) as Hold
  if (current.kind === 'rule') refuse('rule_hold', { handoff_id: row.id, rule: current.rule, reason: current.reason, source_url: current.source_url })
  const venue = (await readVenue(ctx.db, row.venue_id))!, joined = !(await handoffEligibility(ctx.db, venue, row.person_id, ctx.now())).join_first
  // A held hand-off holds no place in the shared limit: if its period filled meanwhile, the limit holds it with the next open date (D-3).
  const full = row.due_at === null ? null : await limitHold(ctx.db, venue, row.due_at, row.id)
  if (full) return changed(ctx, move(actorOf(ctx), row, 'held', 'released', { hold: ruleHoldJson(full, ctx.now()) }, { held_by: current.by, reason: current.reason, rule: full.rule, next_open_at: full.next_open_at }), row)
  return changed(ctx, move(actorOf(ctx), row, joined ? 'open' : 'join_first', 'released', { hold: null }, { held_by: current.by, reason: current.reason }), row)
}
