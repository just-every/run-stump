import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { EDITORS, EVERYONE } from '../people/roles.ts'
import { moveItem, type ItemState } from '../items/state.ts'

const scope = { enum: ['all', 'account'] }
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
  return { scope: 'account', account_id: account.id, label: `${account.network} ${account.handle}` }
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
        const paused = (await ctx.db.prepare(`SELECT id,state,account_id,scheduled_at FROM stump_items i WHERE state='paused'${inScope(target)}
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
}]
