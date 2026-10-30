import { refuse } from '../actions/refusals.ts'
import type { ActionContext } from '../actions/types.ts'
import type { AccountRow } from '../accounts/store.ts'
import { mover } from './schedule.ts'
import { moveItem } from '../items/state.ts'
import { onSlot, slotTimes, validZone, WEEKDAYS, type Slot, type Weekday } from './time.ts'

// Queue slots per account, in the account's own time zone (STUMP-PLAN-002).
// "Add to queue" takes the next slot no other item on that account holds.

export interface Slots { time_zone: string; slots: Slot[] }

export async function readSlots(db: D1Database, accountId: string): Promise<Slots | null> {
  const row = await db.prepare('SELECT time_zone,slots FROM stump_queue_slots WHERE account_id=?').bind(accountId).first<{ time_zone: string; slots: string }>()
  return row ? { time_zone: row.time_zone, slots: JSON.parse(row.slots) as Slot[] } : null
}

/** The slot times other scheduled or paused items already hold on an account. */
async function taken(db: D1Database, accountId: string, except: string | null): Promise<Set<number>> {
  const rows = (await db.prepare("SELECT scheduled_at FROM stump_items WHERE account_id=? AND state IN ('scheduled','paused') AND scheduled_at IS NOT NULL AND id<>?")
    .bind(accountId, except ?? '').all<{ scheduled_at: number }>()).results
  return new Set(rows.map(row => row.scheduled_at))
}

/** The next open slot on an account after `from`, or null when it has no slots. */
export async function nextOpen(db: D1Database, accountId: string, from: number, except: string | null = null, also: Set<number> = new Set()): Promise<number | null> {
  const slots = await readSlots(db, accountId)
  if (!slots?.slots.length) return null
  const busy = await taken(db, accountId, except)
  return slotTimes(slots.slots, slots.time_zone, from).find(at => !busy.has(at) && !also.has(at)) ?? null
}

export function checkSlots(zone: unknown, slots: unknown): Slots {
  if (typeof zone !== 'string' || !validZone(zone)) refuse('invalid_arguments', { field: 'time_zone' })
  if (!Array.isArray(slots)) refuse('invalid_arguments', { field: 'slots' })
  const clean: Slot[] = slots.map((slot, index) => {
    const days = (slot as { days?: unknown }).days, times = (slot as { times?: unknown }).times
    if (!Array.isArray(days) || !days.length || days.some(day => !WEEKDAYS.includes(day as Weekday))) refuse('invalid_arguments', { field: `slots[${index}].days` })
    if (!Array.isArray(times) || !times.length || times.some(time => typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) refuse('invalid_arguments', { field: `slots[${index}].times` })
    return { days: [...new Set(days as Weekday[])], times: [...new Set(times as string[])].sort() }
  })
  return { time_zone: zone, slots: clean }
}

/**
 * Saves an account's slots. Queued items whose slot is gone move to the next
 * open slots, and are listed (STUMP-PLAN-002.4).
 */
export async function saveSlots(ctx: ActionContext, account: AccountRow, next: Slots) {
  const now = ctx.now()
  await ctx.db.prepare(`INSERT INTO stump_queue_slots(account_id,time_zone,slots,updated_by,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(account_id) DO UPDATE SET time_zone=excluded.time_zone,slots=excluded.slots,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(account.id, next.time_zone, JSON.stringify(next.slots), ctx.person.id, now).run()
  const queued = (await ctx.db.prepare("SELECT id,state,scheduled_at FROM stump_items WHERE account_id=? AND queued=1 AND state IN ('scheduled','paused') AND scheduled_at>? ORDER BY scheduled_at,id")
    .bind(account.id, now).all<{ id: string; state: 'scheduled' | 'paused'; scheduled_at: number }>()).results
  const moved: Array<{ item_id: string; from: string; to: string | null }> = [], claimed = new Set<number>()
  for (const item of queued) {
    if (onSlot(item.scheduled_at, next.slots, next.time_zone)) continue
    const to = await nextOpen(ctx.db, account.id, now, item.id, claimed)
    if (to === null) {
      await ctx.db.batch(moveItem(mover(ctx), item, 'held', 'its queue slot was removed',
        { queued: 0, hold: JSON.stringify({ owner_id: ctx.person.id, reason: 'Its queue slot was removed and the account has no other slot.', next_attempt_at: null, kind: 'slot' }) }))
    } else {
      claimed.add(to)
      await ctx.db.batch([
        ctx.db.prepare('UPDATE stump_items SET scheduled_at=?,updated_at=? WHERE id=? AND state=?').bind(to, now, item.id, item.state),
        ctx.db.prepare('INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,agent_id,reason,at) VALUES(?,?,?,?,?,?,?,?)')
          .bind(crypto.randomUUID(), item.id, item.state, item.state, ctx.person.id, ctx.agent?.id ?? null, 'moved to the next open slot', now),
      ])
    }
    moved.push({ item_id: item.id, from: new Date(item.scheduled_at).toISOString(), to: to === null ? null : new Date(to).toISOString() })
  }
  return moved
}

export async function slotsView(db: D1Database, accountId: string, from: number) {
  const slots = await readSlots(db, accountId)
  const busy = await taken(db, accountId, null)
  const upcoming = slots ? slotTimes(slots.slots, slots.time_zone, from, 14).slice(0, 10).map(at => ({ at: new Date(at).toISOString(), taken: busy.has(at) })) : []
  return { account_id: accountId, time_zone: slots?.time_zone ?? null, slots: slots?.slots ?? [], upcoming }
}
