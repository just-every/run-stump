import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import { CORRECTABLE, type Correctable } from './entry.ts'
import { one } from './query.ts'

const link = (value: string) => { try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false } }
const actor = (ctx: ActionContext) => ({ person_id: ctx.person.id, agent_id: ctx.agent?.id ?? null })

/**
 * A correction adds a version: the entry keeps what it was as the first version
 * (a recorded entry that has no versions yet gets that snapshot first), the
 * current entry takes the corrected fields, and every version stays readable.
 */
export async function correct(args: Args, ctx: ActionContext) {
  const id = String(args.entry_id), { row, versions } = await one(ctx, id)
  const changes: Partial<Record<Correctable, string>> = {}
  for (const field of CORRECTABLE) if (typeof args[field] === 'string') changes[field] = args[field] as string
  if (changes.url !== undefined && !link(changes.url)) refuse('invalid_arguments', { field: 'url', reason: 'Use a web address.' })
  const now = ctx.now(), fields = Object.keys(changes) as Correctable[]
  const statements: D1PreparedStatement[] = []
  if (!versions.length) {
    const agent = row.agent ? (JSON.parse(String(row.agent)) as { id?: string }).id ?? null : null
    statements.push(ctx.db.prepare('INSERT INTO stump_ledger_versions(id,entry_id,text,note,fields,person_id,agent_id,at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), id, row.text ?? null, 'As recorded', JSON.stringify(Object.fromEntries(CORRECTABLE.map(field => [field, row[field] ?? null]))), row.person_id ?? null, agent, row.created_at))
  }
  if (fields.length) {
    statements.push(ctx.db.prepare(`UPDATE stump_ledger SET ${fields.map(field => `${field}=?`).join(',')},updated_at=? WHERE id=?`).bind(...fields.map(field => changes[field]), now, id))
  }
  statements.push(ctx.db.prepare('INSERT INTO stump_ledger_versions(id,entry_id,text,note,fields,person_id,agent_id,at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), id, changes.text ?? row.text ?? null, String(args.note).trim(), JSON.stringify(changes), actor(ctx).person_id, actor(ctx).agent_id, now))
  await ctx.db.batch(statements)
  ctx.emit('ledger.corrected', `stump://ledger/${id}`, { fields })
  return (await one(ctx, id)).entry
}

const REMOVABLE = ['posted', 'uncertain']

/** A venue's moderators took the post down: the entry stays on the record, marked removed with the reason. */
export async function markRemoved(args: Args, ctx: ActionContext) {
  const id = String(args.entry_id), { row, entry } = await one(ctx, id)
  if (!REMOVABLE.includes(String(row.state))) {
    if (row.state === 'removed') return entry
    refuse('conflict', { entry_id: id, state: row.state, reason: 'Only a post that went out can be marked removed.' })
  }
  const removal = { reason: String(args.reason).trim(), ...actor(ctx), at: new Date(ctx.now()).toISOString() }
  await ctx.db.prepare("UPDATE stump_ledger SET state='removed',removal=?,updated_at=? WHERE id=? AND state IN ('posted','uncertain')").bind(JSON.stringify(removal), ctx.now(), id).run()
  ctx.emit('ledger.removed', `stump://ledger/${id}`, { reason: removal.reason })
  return (await one(ctx, id)).entry
}

/** A legal hold keeps the entry when the person it names is erased. */
export async function legalHold(args: Args, ctx: ActionContext) {
  const id = String(args.entry_id), { row, entry } = await one(ctx, id)
  if (row.legal_hold) return entry
  const hold = { reason: String(args.reason).trim(), ...actor(ctx), at: new Date(ctx.now()).toISOString() }
  await ctx.db.prepare('UPDATE stump_ledger SET legal_hold=?,updated_at=? WHERE id=? AND legal_hold IS NULL').bind(JSON.stringify(hold), ctx.now(), id).run()
  ctx.emit('ledger.held', `stump://ledger/${id}`, { reason: hold.reason })
  return (await one(ctx, id)).entry
}

/**
 * Every correction on the ledger, newest first: each version an entry gained after
 * the one it was recorded with, with who made it and why. A poster reads only the
 * corrections to their own entries.
 */
export async function corrections(args: Args, ctx: ActionContext) {
  const own = ctx.person.role === 'poster' ? ' AND l.person_id=?' : '', values = [...typeof args.entry_id === 'string' ? [args.entry_id] : [], ...own ? [ctx.person.id] : []]
  const where = `v.rowid>(SELECT MIN(first.rowid) FROM stump_ledger_versions first WHERE first.entry_id=v.entry_id)${typeof args.entry_id === 'string' ? ' AND v.entry_id=?' : ''}${own}`
  const limit = typeof args.limit === 'number' ? args.limit : 200
  const rows = (await ctx.db.prepare(`SELECT v.* FROM stump_ledger_versions v JOIN stump_ledger l ON l.id=v.entry_id WHERE ${where} ORDER BY v.at DESC,v.rowid DESC LIMIT ?`)
    .bind(...values, limit).all<Record<string, unknown>>()).results
  const total = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM stump_ledger_versions v JOIN stump_ledger l ON l.id=v.entry_id WHERE ${where}`).bind(...values).first<{ n: number }>()
  return {
    items: rows.map(row => ({ entry_id: row.entry_id, note: row.note ?? null, text: row.text ?? null, fields: JSON.parse(String(row.fields)) as Record<string, unknown>, person_id: row.person_id ?? null, agent_id: row.agent_id ?? null,
      at: typeof row.at === 'number' ? new Date(row.at).toISOString() : null })),
    total: total?.n ?? 0,
  }
}
