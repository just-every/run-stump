import { ToolRefusal } from '../../modules/agent-door/index.ts'
import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { shownHandle } from '../accounts/handle.ts'
import { readAccount, type AccountRow } from '../accounts/store.ts'
import { CONTRIBUTORS, EDITORS, EVERYONE } from '../people/roles.ts'
import { moveItem, pauseFor, type ItemState } from '../items/state.ts'
import { approvalLine } from '../publish/evidence.ts'
import { readItem } from '../publish/items.ts'
import { commit, item as readSchedulable, money, mover, prepare, publishClasses, remaining, scheduleClasses } from '../publish/schedule.ts'
import { checkSlots, nextOpen, saveSlots, slotsView } from '../publish/slots.ts'

const scope = { enum: ['all', 'account'] }

/** Slots are kept by whoever may publish to the account: its editors, or a personal account's own person. */
async function plannable(ctx: ActionContext, args: Args): Promise<AccountRow> {
  const account = await readAccount(ctx.db, String(args.account_id))
  if (!account) refuse('not_found', { account_id: String(args.account_id) })
  if (account.owner_kind === 'company' ? !EDITORS.includes(ctx.person.role) : account.owner_person_id !== ctx.person.id) refuse('not_account_owner', { account_id: account.id })
  return account
}

/** The item checked for the account's next open slot, as any schedule is checked. */
async function queued(ctx: ActionContext, args: Args) {
  const row = await readSchedulable(ctx, args.item_id)
  const at = await nextOpen(ctx.db, String(args.account_id), ctx.now() + 60_000, row.id)
  if (at === null) refuse('no_open_slot', { account_id: String(args.account_id) })
  return prepare(ctx, 'queue', { item_id: row.id, account_id: args.account_id, at: new Date(at).toISOString() })
}
/** The imported posts a release would put back on the schedule, and what X charges for them when they go out. */
async function releasable(ctx: ActionContext, args: Args) {
  let posts = 0, charge_micro = 0
  const reach = new Map<string, number>()
  for (const id of args.item_ids as string[]) {
    const row = await readItem(ctx.db, id)
    if (!row || row.state !== 'paused' || !(JSON.parse(row.options) as { imported_from?: unknown }).imported_from) continue
    const left = await remaining(ctx, row)
    posts += left.posts; charge_micro += left.charge_micro
    if (row.account_id && left.posts) reach.set(row.account_id, left.followers)
  }
  return { posts, charge_micro, followers: [...reach.values()].reduce((sum, count) => sum + count, 0) }
}
const accountId = { type: 'string', minLength: 1, maxLength: 64 }
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString()

interface Scope { scope: 'all' | 'account'; account_id: string | null }
async function scopeOf(args: Args, ctx: ActionContext): Promise<Scope & { label: string }> {
  const kind = (args.scope as Scope['scope'] | undefined) ?? 'all'
  if (kind === 'all') {
    if (args.account_id !== undefined) refuse('invalid_arguments', { field: 'account_id', reason: 'scope all takes no account' })
    return { scope: 'all', account_id: null, label: 'all publishing' }
  }
  if (typeof args.account_id !== 'string') refuse('invalid_arguments', { field: 'account_id' })
  const account = await ctx.db.prepare('SELECT id,network,handle FROM stump_accounts WHERE id=?').bind(args.account_id).first<{ id: string; network: string; handle: string }>()
  if (!account) refuse('not_found', { account_id: args.account_id })
  return { scope: 'account', account_id: account.id, label: `${account.network} ${shownHandle(account)}` }
}
const key = (target: Scope) => target.scope === 'all' ? 'all' : `account:${target.account_id}`
const live = (service: string, measure = 1) => [{ class: 'live' as const, facts: { measure, service } }]
const inScope = (target: Scope) => target.scope === 'all' ? '' : ' AND account_id=?'
const scopeArgs = (target: Scope) => target.scope === 'all' ? [] : [target.account_id]

export const calendarTools: StumpTool[] = [{
  name: 'stump.calendar.pause', title: 'Pause or resume publishing',
  description: 'Pause all publishing or one account for an incident. Queued items hold; resuming lists what will go out and keeps overdue items held until they are rescheduled or dropped.',
  scope: 'stump:calendar', classes: ['live'], clauses: ['STUMP-PLAN-007'],
  actions: {
    pause: {
      roles: EDITORS,
      properties: { scope, account_id: accountId },
      async classify(args, ctx) { return live((await scopeOf(args, ctx)).label) },
      async summary(args, ctx) { const target = await scopeOf(args, ctx); return { target: { name: `Pause ${target.label}` } } },
      async target(args, ctx) { const target = await scopeOf(args, ctx); return { kind: 'publishing', id: key(target) } },
      async run(args, ctx) {
        const target = await scopeOf(args, ctx), now = ctx.now(), mover = { db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now }
        const existing = await ctx.db.prepare('SELECT paused_at FROM stump_pause WHERE scope_key=?').bind(key(target)).first<{ paused_at: number }>()
        if (existing) return { scope: target.scope, account_id: target.account_id, paused: true, paused_at: iso(existing.paused_at), held: [] }
        const queued = (await ctx.db.prepare(`SELECT id,state FROM stump_items WHERE state='scheduled'${inScope(target)} ORDER BY scheduled_at,id`).bind(...scopeArgs(target)).all<{ id: string; state: ItemState }>()).results
        await ctx.db.batch([
          ctx.db.prepare('INSERT INTO stump_pause(scope_key,scope,account_id,person_id,agent_id,paused_at) VALUES(?,?,?,?,?,?)').bind(key(target), target.scope, target.account_id, ctx.person.id, ctx.agent?.id ?? null, now),
          ctx.db.prepare("INSERT INTO stump_pause_history(id,action,scope,account_id,person_id,agent_id,detail,at) VALUES(?,'pause',?,?,?,?,?,?)")
            .bind(crypto.randomUUID(), target.scope, target.account_id, ctx.person.id, ctx.agent?.id ?? null, JSON.stringify({ held: queued.length }), now),
          ...queued.flatMap(item => moveItem(mover, item, 'paused', 'publishing paused')),
        ])
        ctx.emit('publishing.paused', `stump://publishing/${key(target)}`, { scope: target.scope })
        return { scope: target.scope, account_id: target.account_id, paused: true, paused_at: iso(now), held: queued.map(item => item.id) }
      },
    },
    resume: {
      roles: EDITORS,
      properties: { scope, account_id: accountId },
      async classify(args, ctx) { return live((await scopeOf(args, ctx)).label) },
      async summary(args, ctx) { const target = await scopeOf(args, ctx); return { target: { name: `Resume ${target.label}` } } },
      async target(args, ctx) { const target = await scopeOf(args, ctx); return { kind: 'publishing', id: key(target) } },
      async run(args, ctx) {
        const target = await scopeOf(args, ctx), now = ctx.now(), mover = { db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now }
        const removed = await ctx.db.prepare('DELETE FROM stump_pause WHERE scope_key=? RETURNING scope_key').bind(key(target)).first()
        if (!removed) return { scope: target.scope, account_id: target.account_id, paused: false, will_post: [], held_overdue: [] }
        // Items another Pause still covers stay paused; the rest go out at their time, and overdue ones hold until a person reschedules or drops them.
        // An item paused for its own reason (an import waiting for the person's release, a restore) is not the Pause's to release.
        const paused = (await ctx.db.prepare(`SELECT id,state,account_id,scheduled_at FROM stump_items i WHERE state='paused' AND hold IS NULL${inScope(target)}
          AND NOT EXISTS(SELECT 1 FROM stump_pause p WHERE p.scope_key='all' OR p.scope_key='account:'||i.account_id) ORDER BY scheduled_at,id`)
          .bind(...scopeArgs(target)).all<{ id: string; state: ItemState; account_id: string | null; scheduled_at: number | null }>()).results
        const due = paused.filter(item => item.scheduled_at !== null && item.scheduled_at > now), overdue = paused.filter(item => !due.includes(item))
        await ctx.db.batch([
          ctx.db.prepare("INSERT INTO stump_pause_history(id,action,scope,account_id,person_id,agent_id,detail,at) VALUES(?,'resume',?,?,?,?,?,?)")
            .bind(crypto.randomUUID(), target.scope, target.account_id, ctx.person.id, ctx.agent?.id ?? null, JSON.stringify({ will_post: due.length, held_overdue: overdue.length }), now),
          ...due.flatMap(item => moveItem(mover, item, 'scheduled', 'publishing resumed')),
          ...overdue.flatMap(item => moveItem(mover, item, 'held', 'overdue after a pause',
            { hold: JSON.stringify({ owner_id: ctx.person.id, reason: 'Its time passed while publishing was paused. Reschedule or drop it.', next_attempt_at: null }) })),
        ])
        ctx.emit('publishing.resumed', `stump://publishing/${key(target)}`, { scope: target.scope })
        const view = (item: typeof paused[number]) => ({ item_id: item.id, account_id: item.account_id, scheduled_at: iso(item.scheduled_at) })
        return { scope: target.scope, account_id: target.account_id, paused: false, will_post: due.map(view), held_overdue: overdue.map(view) }
      },
    },
    state: {
      roles: EVERYONE, read: true,
      classify: () => live('publishing', 0),
      async run(_args, ctx) {
        const paused = (await ctx.db.prepare('SELECT scope,account_id,person_id,agent_id,paused_at FROM stump_pause ORDER BY paused_at').all<{ scope: string; account_id: string | null; person_id: string; agent_id: string | null; paused_at: number }>()).results
        const history = (await ctx.db.prepare('SELECT action,scope,account_id,person_id,agent_id,at FROM stump_pause_history ORDER BY at DESC,id LIMIT 200').all<{ action: string; scope: string; account_id: string | null; person_id: string; agent_id: string | null; at: number }>()).results
        return {
          paused: paused.map(row => ({ scope: row.scope, account_id: row.account_id, person_id: row.person_id, agent_id: row.agent_id, at: iso(row.paused_at) })),
          history: history.map(row => ({ action: row.action, scope: row.scope, account_id: row.account_id, person_id: row.person_id, agent_id: row.agent_id, at: iso(row.at) })),
        }
      },
    },
  },
}, {
  name: 'stump.calendar.plan', title: 'Plan the queue',
  description: 'Keep each account\'s queue slots in its own time zone, add an item to the account\'s next open slot, and release imported posts once their old tool\'s queue is cleared.',
  scope: 'stump:calendar', classes: ['standard', 'live', 'external', 'money'], clauses: ['STUMP-PLAN-002', 'STUMP-PLAN-007', 'STUMP-IMPORT-001', 'STUMP-SURFACE-004'],
  actions: {
    set_slots: {
      roles: CONTRIBUTORS,
      properties: { account_id: accountId, time_zone: { type: 'string', minLength: 1, maxLength: 64 },
        slots: { type: 'array', maxItems: 20, items: { type: 'object', required: ['days', 'times'], additionalProperties: false,
          properties: { days: { type: 'array', minItems: 1, maxItems: 7, items: { enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] } },
            times: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' } } } } } },
      required: ['account_id', 'time_zone', 'slots'],
      async classify(args, ctx) { await plannable(ctx, args); return [{ class: 'standard', facts: { measure: 1 } }] },
      target: args => ({ kind: 'account', id: String(args.account_id) }),
      async run(args, ctx) {
        const account = await plannable(ctx, args)
        const moved = await saveSlots(ctx, account, checkSlots(args.time_zone, args.slots))
        return { ...await slotsView(ctx.db, account.id, ctx.now()), moved }
      },
    },
    slots: {
      roles: EVERYONE, read: true,
      properties: { account_id: accountId }, required: ['account_id'],
      classify: () => [{ class: 'standard', facts: { measure: 0 } }],
      async run(args, ctx) {
        const account = await readAccount(ctx.db, String(args.account_id))
        if (!account) refuse('not_found', { account_id: String(args.account_id) })
        return slotsView(ctx.db, account.id, ctx.now())
      },
    },
    queue: {
      roles: CONTRIBUTORS,
      properties: { item_id: accountId, account_id: accountId }, required: ['item_id', 'account_id'],
      // A queued post goes out in public at its slot and X charges for it, as any schedule does.
      async classify(args, ctx) { return [{ class: 'live', facts: { measure: 1, service: 'publishing queue' } }, ...scheduleClasses([await queued(ctx, args)])] },
      async summary(args, ctx) {
        const plan = await queued(ctx, args)
        return { target: { id: plan.item.id, name: `Queue on ${plan.account.network} ${shownHandle(plan.account)} for ${new Date(plan.at).toISOString()}` }, items: [await approvalLine(plan.item, plan.account.id, plan.due)], ...money(plan.charge_micro) }
      },
      target: args => ({ kind: 'item', id: String(args.item_id) }),
      revision: async (args, ctx) => (await readSchedulable(ctx, args.item_id)).revision,
      async run(args, ctx) { return { item: await commit(ctx, await queued(ctx, args), { queued: true }) } },
    },
    release_import: {
      roles: EDITORS,
      properties: { item_ids: { type: 'array', minItems: 1, maxItems: 500, items: accountId }, confirm_source_cleared: { type: 'boolean' } },
      required: ['item_ids', 'confirm_source_cleared'],
      // Confirming the old tool's queue is cleared is the person's own act: an agent's call is refused before any policy decision (BASE-AGENT-008).
      async refuses(args, ctx) {
        if (ctx.agent) refuse('person_only', { field: 'confirm_source_cleared', reason: 'The person confirms the old tool no longer holds these posts, and releases them.' })
      },
      async classify(args, ctx) {
        const { followers, charge_micro } = await releasable(ctx, args)
        return [{ class: 'live', facts: { measure: (args.item_ids as string[]).length, service: 'publishing queue' } }, ...publishClasses(followers, charge_micro)]
      },
      async summary(args, ctx) {
        const { charge_micro } = await releasable(ctx, args)
        return { target: { name: `Release ${(args.item_ids as string[]).length} imported posts` }, items: args.item_ids as string[], ...money(charge_micro) }
      },
      async run(args, ctx) {
        // Imported queued posts stay paused until the person confirms the old tool's queue is cleared, so nothing posts twice.
        if (args.confirm_source_cleared !== true) refuse('confirm_source_cleared', { reason: 'Clear the queue in the tool you switched from first.' })
        const now = ctx.now(), released: string[] = [], overdue: string[] = [], stillPaused: string[] = [], skipped: Array<{ item_id: string; reason: string; fields?: Record<string, unknown> }> = []
        for (const id of args.item_ids as string[]) {
          const row = await readItem(ctx.db, id)
          const imported = row ? (JSON.parse(row.options) as { imported_from?: unknown }).imported_from : undefined
          if (!row || row.state !== 'paused' || !imported) { skipped.push({ item_id: id, reason: !row ? 'not_found' : row.state !== 'paused' ? 'not_paused' : 'not_imported' }); continue }
          if (await pauseFor(ctx.db, row.account_id)) { stillPaused.push(id); continue }
          if (row.scheduled_at !== null && row.scheduled_at > now) {
            // A released post goes on the schedule through every check a schedule meets; one that fails stays paused, named with its reason.
            try {
              await commit(ctx, await prepare(ctx, 'release_import', { item_id: row.id, account_id: row.account_id ?? undefined, at: new Date(row.scheduled_at).toISOString(), time_zone: row.time_zone ?? undefined }, { accountMayWait: true }), { reason: 'import released' })
            } catch (error) {
              if (!(error instanceof ToolRefusal)) throw error
              skipped.push({ item_id: id, reason: error.code, ...(error.details ? { fields: error.details } : {}) })
              continue
            }
            released.push(id)
          } else {
            await ctx.db.batch(moveItem(mover(ctx), row, 'held', 'import released after its time',
              { hold: JSON.stringify({ owner_id: ctx.person.id, reason: 'Its time passed before the import was released. Reschedule or drop it.', next_attempt_at: null, kind: 'overdue' }) }))
            overdue.push(id)
          }
        }
        return { released, held_overdue: overdue, still_paused: stillPaused, skipped }
      },
    },
  },
}]
