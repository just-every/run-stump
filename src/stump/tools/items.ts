import { ToolRefusal } from '../../modules/agent-door/index.ts'
import { refuse, refuseAct } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpTool } from '../actions/types.ts'
import { shownHandle } from '../accounts/handle.ts'
import { readAccount } from '../accounts/store.ts'
import { moveItem, pauseFor } from '../items/state.ts'
import { CONTRIBUTORS, EDITORS } from '../people/roles.ts'
import { itemView, readItem, type FullItemRow } from '../publish/items.ts'
import { agentRuleBroken } from '../publish/rules.ts'
import { blockingFlags, commit, holdOwner, item, mayPublishTo, mover, prepare, resolveUncertain, scheduleClasses, sendNow, SCHEDULABLE, type Plan } from '../publish/schedule.ts'

// stump.items.schedule and stump.items.media: schedule, publish, resume and
// settle items on connected accounts, one master's variants at once, and the
// media an item carries with its alt text (STUMP-PUBLISH-002 to -006, STUMP-DRAFT-010).

const id = { type: 'string', minLength: 1, maxLength: 64 }
const at = { type: 'string', minLength: 10, maxLength: 40 }
const TOOL = 'stump.items.schedule'
const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
/** A D1 row holds about 2 MB; an image stays under it. */
const MEDIA_MAX_BYTES = 1_900_000

const money = (plans: Plan[]) => {
  const micro = plans.reduce((sum, plan) => sum + plan.charge_micro, 0)
  return micro > 0 ? { amount: { value: micro / 1e6, currency: 'USD' }, payee: 'X' } : {}
}
const summary = (plans: Plan[], verb: string) => ({
  target: { name: `${verb} ${plans.length === 1 ? `on ${plans[0]!.account.network} ${shownHandle(plans[0]!.account)}` : `${plans.length} posts`}` },
  items: plans.map(plan => plan.item.id), ...money(plans),
})

/** May this person settle an uncertain item: whoever holds it, the account's owner, or an admin. */
async function maySettle(ctx: ActionContext, row: FullItemRow) {
  if (ctx.person.role === 'owner' || ctx.person.role === 'admin' || holdOwner(row) === ctx.person.id) return
  const account = row.account_id ? await readAccount(ctx.db, row.account_id) : null
  if (account?.owner_person_id === ctx.person.id) return
  refuse('not_hold_owner', { item_id: row.id, owner_id: holdOwner(row) })
}

/** The checks a partly posted item passes before the rest of it goes out. */
async function resumable(ctx: ActionContext, args: Args): Promise<{ row: FullItemRow; plan: Plan | null }> {
  const row = await item(ctx, args.item_id)
  if (row.state === 'held') return { row, plan: await prepare(ctx, 'resume', { item_id: row.id }, { now: true }) }
  if (row.state !== 'partly_posted') refuse('not_resumable', { item_id: row.id, state: row.state })
  const account = row.account_id ? await readAccount(ctx.db, row.account_id) : null
  if (!account || account.state !== 'connected') refuse('account_not_connected', { account_id: row.account_id, state: account?.state ?? null, reconnect_url: account?.reconnect_url ?? null })
  mayPublishTo(ctx, account, row)
  const broken = ctx.agent ? agentRuleBroken(account) : null
  if (broken) await refuseAct(ctx, TOOL, 'resume', broken.source, { account_id: account.id, reason: broken.reason })
  return { row, plan: null }
}

interface MasterPlan { plans: Plan[]; held: Array<{ item_id: string; reason: string; flag?: unknown; fields?: Record<string, unknown> }> }

/** Each variant of a master: checked on its own; one that fails a check holds alone (STUMP-DRAFT-010.6). */
async function masterPlan(ctx: ActionContext, args: Args): Promise<MasterPlan> {
  const rows = (await ctx.db.prepare(`SELECT id FROM stump_items WHERE master_id=? AND state IN (${SCHEDULABLE.map(() => '?').join(',')}) ORDER BY created_at,id`)
    .bind(String(args.master_id), ...SCHEDULABLE).all<{ id: string }>()).results
  if (!rows.length) refuse('not_found', { master_id: String(args.master_id) })
  const plans: Plan[] = [], held: MasterPlan['held'] = []
  for (const variant of rows) {
    try {
      const plan = await prepare(ctx, 'schedule_master', { item_id: variant.id, at: args.at }, { holdFlagged: true })
      const flagged = blockingFlags(plan.item)
      if (flagged.length) held.push({ item_id: variant.id, reason: flagged[0]!.code, flag: flagged[0] })
      else plans.push(plan)
    } catch (error) {
      // A product rule refuses the whole call; any other check holds only this variant.
      if (!(error instanceof ToolRefusal) || error.code === 'act_refused' || error.code === 'forbidden' || error.code === 'not_account_owner') throw error
      held.push({ item_id: variant.id, reason: error.code, fields: error.details })
    }
  }
  return { plans, held }
}

export const itemTools: StumpTool[] = [{
  name: TOOL, title: 'Schedule and publish items',
  description: 'Schedule an item to a connected account at a time in its time zone, publish it now, resume a partly posted thread, settle an item the network never confirmed, or schedule every variant of a master post with one action. A post reads as posted only once the network reads it back.',
  scope: 'stump:items', classes: ['external', 'money', 'gated'], clauses: ['STUMP-PUBLISH-002', 'STUMP-PUBLISH-003', 'STUMP-PUBLISH-004', 'STUMP-PUBLISH-005', 'STUMP-PUBLISH-006', 'STUMP-DRAFT-010'],
  actions: {
    schedule: {
      roles: CONTRIBUTORS,
      properties: { item_id: id, account_id: id, at, time_zone: { type: 'string', minLength: 1, maxLength: 64 } }, required: ['item_id', 'account_id', 'at'],
      async classify(args, ctx) { return scheduleClasses([await prepare(ctx, 'schedule', args)]) },
      async summary(args, ctx) { return summary([await prepare(ctx, 'schedule', args)], 'Schedule a post') },
      target: args => ({ kind: 'item', id: String(args.item_id) }),
      async run(args, ctx) { return { item: await commit(ctx, await prepare(ctx, 'schedule', args)) } },
    },
    publish: {
      roles: CONTRIBUTORS,
      properties: { item_id: id, account_id: id }, required: ['item_id'],
      async classify(args, ctx) { return scheduleClasses([await prepare(ctx, 'publish', args, { now: true })]) },
      async summary(args, ctx) { return summary([await prepare(ctx, 'publish', args, { now: true })], 'Publish now') },
      target: args => ({ kind: 'item', id: String(args.item_id) }),
      async run(args, ctx) {
        const plan = await prepare(ctx, 'publish', args, { now: true })
        const pause = await pauseFor(ctx.db, plan.account.id)
        if (pause) refuse('publishing_paused', { scope: pause.scope, account_id: pause.account_id })
        await commit(ctx, plan)
        return sendNow(ctx, plan.item.id, 'scheduled')
      },
    },
    resume: {
      roles: CONTRIBUTORS,
      properties: { item_id: id }, required: ['item_id'],
      async classify(args, ctx) {
        const { row, plan } = await resumable(ctx, args)
        if (plan) return scheduleClasses([plan])
        const done = await ctx.db.prepare('SELECT COUNT(*) AS n FROM stump_item_parts WHERE item_id=?').bind(row.id).first<{ n: number }>()
        const total = row.parts ? (JSON.parse(row.parts) as string[]).length : 1
        return [{ class: 'external', facts: { measure: Math.max(0, total - (done?.n ?? 0)), counterparty: 'public' } }]
      },
      target: args => ({ kind: 'item', id: String(args.item_id) }),
      async run(args, ctx) {
        const { row, plan } = await resumable(ctx, args)
        if (!plan) return sendNow(ctx, row.id, 'partly_posted')
        const pause = await pauseFor(ctx.db, plan.account.id)
        if (pause) refuse('publishing_paused', { scope: pause.scope, account_id: pause.account_id })
        await commit(ctx, plan)
        return sendNow(ctx, row.id, 'scheduled')
      },
    },
    resolve: {
      roles: CONTRIBUTORS,
      properties: { item_id: id, decision: { enum: ['posted', 'not_posted', 'retry'] }, url: { type: 'string', minLength: 8, maxLength: 2048 } }, required: ['item_id', 'decision'],
      async classify(args, ctx) {
        const row = await item(ctx, args.item_id)
        if (row.state !== 'uncertain') refuse('not_uncertain', { item_id: row.id, state: row.state })
        await maySettle(ctx, row)
        return [{ class: 'gated', facts: { measure: 1, provider: row.network ?? 'network', step: 'uncertain_outcome' } },
          ...(args.decision === 'retry' ? [{ class: 'external' as const, facts: { measure: 1, counterparty: 'public' as const } }] : [])]
      },
      target: args => ({ kind: 'item', id: String(args.item_id) }),
      async run(args, ctx) {
        const row = await item(ctx, args.item_id)
        if (row.state !== 'uncertain') refuse('not_uncertain', { item_id: row.id, state: row.state })
        await maySettle(ctx, row)
        const decision = args.decision as 'posted' | 'not_posted' | 'retry'
        const settled = await resolveUncertain(ctx, row, decision, typeof args.url === 'string' ? args.url : undefined)
        if (decision !== 'retry') return { item: settled }
        // The owner chose to send it again: it goes out now, through every check.
        const plan = await prepare(ctx, 'resolve', { item_id: row.id }, { now: true })
        await commit(ctx, plan)
        return sendNow(ctx, row.id, 'scheduled')
      },
    },
    schedule_master: {
      roles: CONTRIBUTORS,
      properties: { master_id: id, at }, required: ['master_id', 'at'],
      async classify(args, ctx) { const plan = await masterPlan(ctx, args); return scheduleClasses(plan.plans, plan.held.length) },
      async summary(args, ctx) { return summary((await masterPlan(ctx, args)).plans, 'Schedule every variant') },
      target: args => ({ kind: 'master', id: String(args.master_id) }),
      async run(args, ctx) {
        const plan = await masterPlan(ctx, args), now = ctx.now()
        for (const hold of plan.held) {
          const row = (await readItem(ctx.db, hold.item_id))!
          const value = JSON.stringify({ owner_id: ctx.person.id, reason: hold.reason, next_attempt_at: null, kind: 'check', ...(hold.flag ? { flag: hold.flag } : {}), ...(hold.fields ? { fields: hold.fields } : {}) })
          if (row.state === 'held') await ctx.db.prepare('UPDATE stump_items SET hold=?,updated_at=? WHERE id=?').bind(value, now, row.id).run()
          else await ctx.db.batch(moveItem(mover(ctx), row, 'held', `held: ${hold.reason}`, { hold: value }))
        }
        const scheduled = []
        for (const variant of plan.plans) scheduled.push(await commit(ctx, variant))
        return { master_id: String(args.master_id), scheduled, held: plan.held.map(hold => ({ item_id: hold.item_id, reason: hold.reason, ...(hold.flag ? { flag: hold.flag } : {}) })) }
      },
    },
  },
}, {
  name: 'stump.items.media', title: 'Attach media with alt text',
  description: 'Attach an image to an item with its alt text, or change an image\'s alt text. An image without alt text keeps its item from being scheduled.',
  scope: 'stump:items', classes: ['standard'], clauses: ['STUMP-PUBLISH-002', 'STUMP-PUBLISH-003', 'STUMP-PUBLISH-004', 'STUMP-PUBLISH-005'],
  actions: {
    attach: {
      roles: CONTRIBUTORS,
      properties: { item_id: id, file: { type: 'object', additionalProperties: false, required: ['name', 'type', 'base64'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, type: { enum: MEDIA_TYPES }, base64: { type: 'string', minLength: 4, maxLength: 2_600_000 } } },
        alt: { type: 'string', maxLength: 2000 } },
      required: ['item_id', 'file'],
      classify: () => [{ class: 'standard', facts: { measure: 1 } }],
      target: args => ({ kind: 'item', id: String(args.item_id) }),
      async run(args, ctx) {
        const row = await item(ctx, args.item_id)
        if (row.person_id !== ctx.person.id && !EDITORS.includes(ctx.person.role)) refuse('forbidden', { item_id: row.id })
        if (!['draft', 'ready', 'held', 'failed', 'scheduled', 'paused'].includes(row.state)) refuse('not_editable', { item_id: row.id, state: row.state })
        const file = args.file as { name: string; type: string; base64: string }
        let bytes: Uint8Array
        try { bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0)) } catch { refuse('invalid_arguments', { field: 'file.base64' }) }
        if (!bytes.byteLength) refuse('invalid_arguments', { field: 'file.base64' })
        if (bytes.byteLength > MEDIA_MAX_BYTES) refuse('media_too_large', { size: bytes.byteLength, limit: MEDIA_MAX_BYTES })
        const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
        const mediaId = crypto.randomUUID(), alt = typeof args.alt === 'string' && args.alt.trim() ? args.alt.trim() : null
        await ctx.db.prepare('INSERT INTO stump_media(id,item_id,name,type,size,sha256,bytes,alt,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .bind(mediaId, row.id, file.name, file.type, bytes.byteLength, sha, bytes, alt, ctx.person.id, ctx.now()).run()
        return { media: { id: mediaId, item_id: row.id, name: file.name, type: file.type, size: bytes.byteLength, sha256: sha, alt }, item: await itemView(ctx.db, row) }
      },
    },
    set_alt: {
      roles: CONTRIBUTORS,
      properties: { media_id: id, alt: { type: 'string', maxLength: 2000 } }, required: ['media_id', 'alt'],
      classify: () => [{ class: 'standard', facts: { measure: 1 } }],
      target: args => ({ kind: 'media', id: String(args.media_id) }),
      async run(args, ctx) {
        const media = await ctx.db.prepare('SELECT m.id,m.item_id,m.name,m.type,m.size,i.person_id FROM stump_media m LEFT JOIN stump_items i ON i.id=m.item_id WHERE m.id=?')
          .bind(String(args.media_id)).first<{ id: string; item_id: string | null; name: string; type: string; size: number; person_id: string | null }>()
        if (!media) refuse('not_found', { media_id: String(args.media_id) })
        if (media.person_id !== ctx.person.id && !EDITORS.includes(ctx.person.role)) refuse('forbidden', { media_id: media.id })
        const alt = String(args.alt).trim() || null
        await ctx.db.prepare('UPDATE stump_media SET alt=? WHERE id=?').bind(alt, media.id).run()
        return { media: { id: media.id, item_id: media.item_id, name: media.name, type: media.type, size: media.size, alt } }
      },
    },
  },
}]
