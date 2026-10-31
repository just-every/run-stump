import { refuse, refuseAct } from '../actions/refusals.ts'
import type { ActionContext } from '../actions/types.ts'
import { xPrices } from '../accounts/apps.ts'
import { readAccount, type AccountRow } from '../accounts/store.ts'
import { heldForImport, moveItem, pauseFor, type ItemState, type Mover } from '../items/state.ts'
import { ANSWERED, ownPostIds } from '../inbox/store.ts'
import { checkDraft, loadBrand } from '../drafting/check.ts'
import { recordOutcome } from '../ledger/record.ts'
import { EDITORS } from '../people/roles.ts'
import { readPerson } from '../people/store.ts'
import { itemView, readItem, type FullItemRow } from './items.ts'
import { publishers } from './publishers.ts'
import { agentRuleBroken, ONE_REPLY, UNENGAGED, X_AI_STEP } from './rules.ts'
import { textsOf } from './parts.ts'
import { afterPosted, blockingFlags, claim, deliver, holdOwner, sendable } from './tick.ts'
import { parseAt, validZone } from './time.ts'
import type { DueItem } from './types.ts'

// Scheduling and delivery truth (STUMP-PUBLISH-006, STUMP-DRAFT-010). Every
// door schedules through prepare(): the same checks, in the same order, before
// anything changes. Product rules (D-1, D-4) refuse with act_refused before
// any policy decision; an item with a blocking flag is never schedulable.

export const SCHEDULABLE: readonly ItemState[] = ['draft', 'ready', 'failed', 'held', 'paused', 'scheduled']
const TOOL = 'stump.items.schedule'

export { blockingFlags }
export type { Flag } from './tick.ts'

/** `checked` holds the draft check run again for an account other than the one the item was checked for, which commit stores. */
export interface Plan { item: FullItemRow; account: AccountRow; due: DueItem; at: number; zone: string; charge_micro: number; posts: number; checked: { flags: string; claims_used: string } | null }

export const mover = (ctx: ActionContext): Mover => ({ db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now })

export async function item(ctx: ActionContext, id: unknown): Promise<FullItemRow> {
  const row = await readItem(ctx.db, String(id))
  if (!row) refuse('not_found', { item_id: String(id) })
  return row
}

/** Who may publish to an account: a company account's editors, or a personal account's own person. */
export function mayPublishTo(ctx: ActionContext, account: AccountRow, row: FullItemRow) {
  if (account.owner_kind === 'company') {
    if (!EDITORS.includes(ctx.person.role)) refuse('forbidden', { reason: 'company_accounts_need_editor', role: ctx.person.role })
  } else {
    if (account.owner_person_id !== ctx.person.id) refuse('not_account_owner', { account_id: account.id, owner: { kind: 'person', person_id: account.owner_person_id } })
    // A personal account speaks only for its own person (D-1).
    if (row.person_id !== account.owner_person_id) refuse('not_item_person', { item_id: row.id, person_id: row.person_id, account_id: account.id })
  }
}

/**
 * D-1: one person may not post from two of their accounts into the same
 * thread to look like two voices (STUMP-TRUTH-001.4).
 */
async function oneVoicePerThread(ctx: ActionContext, action: string, row: FullItemRow, account: AccountRow) {
  if (account.owner_kind !== 'person' || !row.reply_to) return
  const thread = (JSON.parse(row.reply_to) as { url: string }).url
  const first = await ctx.db.prepare(`SELECT i.url FROM stump_items i JOIN stump_accounts a ON a.id=i.account_id
    WHERE a.owner_kind='person' AND a.owner_person_id=? AND i.account_id<>? AND i.state IN ('posted','partly_posted','scheduled','posting','uncertain')
      AND (i.url=? OR json_extract(i.reply_to,'$.url')=?) ORDER BY COALESCE(i.posted_at,i.scheduled_at) LIMIT 1`)
    .bind(account.owner_person_id, account.id, thread, thread).first<{ url: string | null }>()
  if (first) await refuseAct(ctx, TOOL, action, { rule: 'D-1', source: 'STUMP-TRUTH-001' }, { account_id: account.id }, { thread_url: thread, first_post: first.url ?? thread })
}

const xStatusId = (url: string) => /\/status(?:es)?\/(\d{1,19})/.exec(url)?.[1] ?? null

/**
 * Another reply from this account to the same X post that is out or on its way, whichever
 * door wrote it: an interaction is answered once (D-4).
 */
export async function earlierReply(db: D1Database, accountId: string, statusId: string, except: ReadonlyArray<string | null>) {
  const rows = (await db.prepare(`SELECT id,state,url,reply_to FROM stump_items WHERE account_id=? AND reply_to IS NOT NULL
    AND state IN (SELECT value FROM json_each(?)) AND instr(json_extract(reply_to,'$.url'),?)>0 ORDER BY COALESCE(posted_at,scheduled_at),id`)
    .bind(accountId, JSON.stringify(ANSWERED), statusId).all<{ id: string; state: ItemState; url: string | null; reply_to: string }>()).results
  return rows.find(row => !except.includes(row.id) && xStatusId((JSON.parse(row.reply_to) as { url: string }).url) === statusId) ?? null
}

/**
 * D-4 on every publishing door: a reply on X goes only to the account's own post or to
 * a post whose author engaged with the account first, and only once per interaction.
 */
async function engagedFirst(ctx: ActionContext, action: string, row: FullItemRow, account: AccountRow) {
  if (account.network !== 'x' || !row.reply_to) return
  const url = (JSON.parse(row.reply_to) as { url: string }).url, id = xStatusId(url)
  // An address that names no X post is the publisher's check to refuse.
  if (!id) return
  // The account's own post: one Stump posted or recorded on the ledger, or one X showed as the account's when the inbox read a reply to it.
  const own = (await ownPostIds(ctx.db, account.id, [id])).has(id) || await ctx.db.prepare(`SELECT 1 FROM stump_items WHERE account_id=? AND network_id=?
    UNION ALL SELECT 1 FROM stump_inbox_items WHERE account_id=? AND parent_network_id=? AND parent_own=1 LIMIT 1`).bind(account.id, id, account.id, id).first()
  if (own) return
  const inbox = await ctx.db.prepare('SELECT id,engaged_first FROM stump_inbox_items WHERE account_id=? AND network_id=?').bind(account.id, id)
    .first<{ id: string; engaged_first: number }>()
  if (inbox?.engaged_first !== 1) await refuseAct(ctx, TOOL, action, UNENGAGED, { act: 'x_unengaged_reply', item_id: row.id, url, route: 'handoff' })
  const earlier = await earlierReply(ctx.db, account.id, id, [row.id])
  if (earlier) await refuseAct(ctx, TOOL, action, ONE_REPLY, { act: 'x_one_reply_per_interaction', item_id: row.id, inbox_item_id: inbox!.id, reply_item_id: earlier.id, reply_url: earlier.url })
}

/**
 * A step a provider keeps for a person, which no policy answers: the step an item is
 * held at, or X's prior approval of an AI-drafted reply, which the company has not
 * recorded (STUMP-SURFACE-005.4, BASE-AGENT-008).
 */
function providerStep(row: FullItemRow, account: AccountRow): { provider: string | null; step: string; reason: string } | null {
  const hold = row.hold ? JSON.parse(row.hold) as { provider?: string; step?: unknown; detail?: string; reason?: string } : null
  if (typeof hold?.step === 'string') return { provider: hold.provider ?? null, step: hold.step, reason: hold.detail ?? hold.reason ?? hold.step }
  if (account.network === 'x' && row.ai && row.reply_to) {
    return { provider: 'x', step: X_AI_STEP, reason: 'X asks for its approval before an app posts AI-drafted replies, and the company has not recorded it. Write your own reply instead.' }
  }
  return null
}

/**
 * The item's draft check for the account it goes out on. Disclosure, near-duplicates and the
 * network's count depend on the account, so an item checked for another account (or none) is
 * checked again for this one, and that check decides (D-2, STUMP-TRUTH-004).
 */
async function checkedFor(ctx: ActionContext, row: FullItemRow, account: AccountRow): Promise<Plan['checked']> {
  if (row.account_id === account.id) return null
  const draft = { ...row, account_id: account.id, network: row.network ?? account.network, parts: row.parts ? JSON.parse(row.parts) as string[] : null,
    reply_to: row.reply_to ? JSON.parse(row.reply_to) as unknown : null, options: JSON.parse(row.options) as Record<string, unknown> }
  const check = await checkDraft(ctx.db, await loadBrand(ctx.db), draft, await readPerson(ctx.db, row.person_id), ctx.now())
  return { flags: JSON.stringify(check.flags), claims_used: JSON.stringify(check.claims_used) }
}

/** Checks one item for one account at one time and answers what scheduling it means. Changes nothing. */
export async function prepare(ctx: ActionContext, action: string, input: { item_id?: unknown; account_id?: unknown; at?: unknown; time_zone?: unknown }, options: { now?: boolean; holdFlagged?: boolean; accountMayWait?: boolean } = {}): Promise<Plan> {
  const stored = await item(ctx, input.item_id)
  let row = stored
  if (!SCHEDULABLE.includes(row.state)) refuse('not_schedulable', { item_id: row.id, state: row.state })
  // An imported post goes on the schedule only when the person releases it, confirming the tool it came from no longer queues it.
  if (heldForImport(row) && action !== 'release_import') {
    if (ctx.agent) refuse('person_only', { item_id: row.id, field: 'confirm_source_cleared', reason: 'The person confirms the old tool no longer holds this post, and releases it.' })
    refuse('held', { item_id: row.id, reason: 'import', release: { tool: 'stump.calendar.plan', action: 'release_import' }, detail: (JSON.parse(row.hold!) as { reason?: string }).reason ?? null })
  }
  const accountId = typeof input.account_id === 'string' ? input.account_id : row.account_id
  if (!accountId) refuse('invalid_arguments', { field: 'account_id' })
  const account = await readAccount(ctx.db, accountId)
  if (!account) refuse('not_found', { account_id: accountId })
  // A released import may wait for its account's owner to reconnect it: at its time it holds with the reconnect step, and a reschedule runs every check again.
  const waiting = options.accountMayWait === true && account.state === 'expired'
  if (account.state !== 'connected' && !waiting) refuse('account_not_connected', { account_id: account.id, state: account.state, reconnect_url: account.reconnect_url })
  if (row.network && row.network !== account.network) refuse('network_mismatch', { item_network: row.network, account_network: account.network })
  mayPublishTo(ctx, account, row)
  await oneVoicePerThread(ctx, action, row, account)
  await engagedFirst(ctx, action, row, account)
  const broken = ctx.agent ? agentRuleBroken(account) : null
  if (broken) await refuseAct(ctx, TOOL, action, broken.source, { account_id: account.id, reason: broken.reason, ...(broken.rules ? { rules: broken.rules } : {}) })
  // Whatever the policy says, a step a provider keeps for a person stays with that person.
  const step = providerStep(row, account)
  if (step) refuse('held', { item_id: row.id, ...step })
  const checked = await checkedFor(ctx, stored, account)
  if (checked) row = { ...stored, flags: checked.flags }
  const flagged = blockingFlags(row)
  if (flagged.length && !options.holdFlagged) refuse('item_flagged', { item_id: row.id, flag: flagged[0]!.code, flags: flagged })
  // The checks see the text as it will go out, own links tagged (STUMP-LINK-001).
  const due = await sendable(ctx.db, row, account)
  const missingAlt = due.media.find(media => !media.alt?.trim())
  if (missingAlt) refuse('alt_text_missing', { item_id: row.id, media_id: missingAlt.id })
  const publisher = publishers[account.network]
  if (!publisher) refuse('network_unsupported', { network: account.network })
  const slots = await ctx.db.prepare('SELECT time_zone FROM stump_queue_slots WHERE account_id=?').bind(account.id).first<{ time_zone: string }>()
  const zone = typeof input.time_zone === 'string' ? input.time_zone : row.time_zone ?? slots?.time_zone ?? 'UTC'
  if (!validZone(zone)) refuse('invalid_arguments', { field: 'time_zone' })
  const at = options.now ? ctx.now() : typeof input.at === 'string' ? parseAt(input.at, zone) : null
  if (at === null) refuse('invalid_arguments', { field: 'at' })
  if (at < ctx.now() - 60_000) refuse('in_the_past', { at: new Date(at).toISOString() })
  const env = { db: ctx.db, env: ctx.env, account, prices: await xPrices(ctx.db), now: ctx.now }
  // The network's own check needs the account open; an account that waits for its owner is checked when it is scheduled again.
  const problems = waiting ? [] : await publisher.check({ ...due, scheduled_at: at }, env)
  if (problems.length) refuse(problems.some(problem => /too_long|over/.test(problem.code)) ? 'over_limit' : 'not_publishable', { network: account.network, account_id: account.id, problems })
  return { item: row, account, due, at, zone, charge_micro: publisher.quote?.(due, env.prices) ?? 0, posts: due.format === 'thread' ? due.parts?.length ?? 0 : 1, checked }
}

/** The charge in US dollars as the approval summary's amount, paid to X. */
export const money = (micro: number) => micro > 0 ? { amount: { value: micro / 1e6, currency: 'USD' }, payee: 'X' } : {}

/** The people a post on these accounts reaches: each account's follower count as the network last reported it, once per account. */
export function audience(accounts: Array<Pick<AccountRow, 'id' | 'follower_count'>>): number {
  return [...new Map(accounts.map(account => [account.id, account.follower_count ?? 0])).values()].reduce((sum, count) => sum + count, 0)
}

/**
 * The classes sending posts computes (V1 "Agent door"): external to the public,
 * measured by the followers of the accounts it goes to; money for what X charges
 * for this one call in US dollars, priced once from the company's table (only X
 * charges per post, so X is the counterparty); and variants held for a person.
 * The agent door's adapted policy copy takes a money measure to the millionth.
 */
export function publishClasses(followers: number, micro: number, held = 0) {
  return [
    { class: 'external' as const, facts: { measure: followers, counterparty: 'public' as const } },
    ...(micro > 0 ? [{ class: 'money' as const, facts: { measure: micro / 1e6, currency: 'usd', counterparty: 'x' } }] : []),
    ...(held > 0 ? [{ class: 'gated' as const, facts: { measure: held, provider: 'stump', step: 'rewrite_flagged_variant' } }] : []),
  ]
}

/** The classes a schedule computes from its plans. */
export const scheduleClasses = (plans: Plan[], held = 0) =>
  publishClasses(audience(plans.map(plan => plan.account)), plans.reduce((sum, plan) => sum + plan.charge_micro, 0), held)

/** The posts of an item not yet out at its network, and what sending them costs from the company's price table (STUMP-SURFACE-004). */
export async function remaining(ctx: ActionContext, row: FullItemRow): Promise<{ posts: number; charge_micro: number; followers: number }> {
  const account = row.account_id ? await readAccount(ctx.db, row.account_id) : null
  if (!account) return { posts: 0, charge_micro: 0, followers: 0 }
  const due = await sendable(ctx.db, row, account), texts = textsOf(due), followers = audience([account])
  const done = (await ctx.db.prepare('SELECT COUNT(*) AS n FROM stump_item_parts WHERE item_id=?').bind(row.id).first<{ n: number }>())?.n ?? 0
  if (done >= texts.length) return { posts: 0, charge_micro: 0, followers }
  const rest: DueItem = due.format === 'thread' ? { ...due, parts: texts.slice(done) } : due
  return { posts: texts.length - done, charge_micro: publishers[account.network]?.quote?.(rest, await xPrices(ctx.db)) ?? 0, followers }
}

/**
 * Puts a checked item on the schedule: paused while a Pause covers its account. Only the
 * revision that was checked goes on: an item saved since answers revision_conflict.
 */
export async function commit(ctx: ActionContext, plan: Plan, options: { queued?: boolean; reason?: string } = {}) {
  const { item: row, account } = plan, now = ctx.now(), pause = await pauseFor(ctx.db, account.id), guard = { revision: row.revision }
  const scheduledBy = JSON.stringify({ person_id: ctx.person.id, agent: ctx.agent ? { id: ctx.agent.id, name: ctx.agent.name } : null, approved_by: ctx.approvers, at: new Date(now).toISOString() })
  const set = {
    account_id: account.id, network: account.network, scheduled_at: plan.at, time_zone: plan.zone, scheduled_by: scheduledBy, queued: options.queued ? 1 : 0, hold: null, error: null,
    // The check for the account it now goes out on replaces the one made for another account.
    ...(plan.checked ? { flags: plan.checked.flags, claims_used: plan.checked.claims_used } : {}),
    ...(ctx.approvers.length ? { approved_by: JSON.stringify(ctx.approvers) } : {}),
    ...(ctx.agent && !row.agent ? { agent: JSON.stringify({ id: ctx.agent.id, name: ctx.agent.name }) } : {}),
  }
  const to: ItemState = pause ? 'paused' : 'scheduled'
  let written: D1Result[]
  if (row.state === to) {
    // Rescheduling keeps the state; the history still records the new time.
    const columns = Object.keys(set)
    written = await ctx.db.batch([
      ctx.db.prepare(`UPDATE stump_items SET ${columns.map(column => `${column}=?`).join(',')},updated_at=? WHERE id=? AND state=? AND revision=?`).bind(...Object.values(set), now, row.id, row.state, row.revision),
      ctx.db.prepare('INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,agent_id,reason,at) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1')
        .bind(crypto.randomUUID(), row.id, row.state, to, ctx.person.id, ctx.agent?.id ?? null, options.reason ?? 'rescheduled', now),
    ])
  } else if (row.state === 'paused' || row.state === 'scheduled') {
    written = await ctx.db.batch(moveItem(mover(ctx), row, to, pause ? 'publishing paused' : options.reason ?? 'scheduled', set, guard))
  } else {
    // It joins the schedule, and a Pause covering its account holds it at once.
    written = await ctx.db.batch([
      ...moveItem(mover(ctx), row, 'scheduled', options.reason ?? 'scheduled', set, guard),
      ...(pause ? moveItem(mover(ctx), { id: row.id, state: 'scheduled' }, 'paused', 'publishing paused') : []),
    ])
  }
  if (!written[0]!.meta.changes) {
    const current = await readItem(ctx.db, row.id)
    refuse('revision_conflict', { item_id: row.id, current_revision: current?.revision ?? null, state: current?.state ?? null })
  }
  ctx.emit('item.scheduled', `stump://items/${row.id}`, { account_id: account.id })
  return itemView(ctx.db, (await readItem(ctx.db, row.id))!)
}

/** Sends a scheduled or partly posted item now and answers what the network said. */
export async function sendNow(ctx: ActionContext, id: string, from: 'scheduled' | 'partly_posted') {
  const row = await item(ctx, id)
  const pause = await pauseFor(ctx.db, row.account_id)
  if (pause) refuse('publishing_paused', { scope: pause.scope, account_id: pause.account_id })
  if (!await claim(ctx.db, row, from, ctx.now(), from === 'scheduled' ? 'published now' : 'resumed')) refuse('conflict', { item_id: row.id, state: (await readItem(ctx.db, row.id))?.state })
  const outcome = await deliver(ctx.env, row, mover(ctx))
  return { outcome: outcome.state, item: await itemView(ctx.db, (await readItem(ctx.db, row.id))!) }
}

/** The owner's decision about an item whose outcome the network never confirmed (D-5). */
export async function resolveUncertain(ctx: ActionContext, row: FullItemRow, decision: 'posted' | 'not_posted' | 'retry', url: string | undefined) {
  const now = ctx.now()
  if (decision === 'posted') {
    if (!url) refuse('invalid_arguments', { field: 'url', reason: 'Give the post\'s address so Stump can read it back.' })
    const account = row.account_id ? await readAccount(ctx.db, row.account_id) : null
    const publisher = account ? publishers[account.network] : undefined
    if (!account || !publisher?.readBack) refuse('account_not_connected', { account_id: row.account_id })
    const back = await publisher.readBack(url, { db: ctx.db, env: ctx.env, account, prices: await xPrices(ctx.db), now: ctx.now })
    if (!back.ok) refuse('not_found_at_network', { url, network: account.network, message: back.message })
    await ctx.db.batch([
      ...moveItem(mover(ctx), row, 'posted', 'owner confirmed; network read back', { url: back.url, network_id: back.network_id, posted_at: now, hold: null, error: null }),
      ...await recordOutcome(ctx.db, row, { state: 'posted', url: back.url, network_id: back.network_id,
        text: back.text ?? (row.parts ? (JSON.parse(row.parts) as string[]).join('\n\n') : row.text ?? ''), posted_at: now }, now),
    ])
    await afterPosted(ctx.env, row.id, account.id, back.followers)
  } else {
    const error = row.error ? JSON.parse(row.error) as { code: string; message: string } : { code: 'uncertain', message: 'The network did not confirm this post.' }
    await ctx.db.batch([
      ...moveItem(mover(ctx), row, 'failed', decision === 'retry' ? 'owner chose to send again' : 'owner found it did not post', { hold: null }),
      ...await recordOutcome(ctx.db, row, { state: 'failed', url: null, network_id: null, error }, now),
    ])
  }
  return itemView(ctx.db, (await readItem(ctx.db, row.id))!)
}

export { holdOwner }
