import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import { xPrices } from '../accounts/apps.ts'
import { readAccount } from '../accounts/store.ts'
import { publishers } from '../publish/publishers.ts'
import type { RemoveOutcome } from '../publish/types.ts'
import { CORRECTABLE, currentVersion, holdsCurrent, type Correctable } from './entry.ts'
import { one } from './query.ts'

const link = (value: string) => { try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false } }
const REMOVABLE = ['posted', 'uncertain']
const actor = (ctx: ActionContext) => ({ person_id: ctx.person.id, agent_id: ctx.agent?.id ?? null })

/**
 * A correction adds a version and keeps every earlier one readable. When no stored
 * version holds the entry as it stands (an entry never versioned, or one the recorder
 * changed after writing its earlier state), that state is kept first as a snapshot;
 * then the entry takes the corrected fields and the correction is the newest version.
 */
export async function correct(args: Args, ctx: ActionContext) {
  const id = String(args.entry_id), { row, versions } = await one(ctx, id)
  const changes: Partial<Record<Correctable, string>> = {}
  for (const field of CORRECTABLE) if (typeof args[field] === 'string') changes[field] = args[field] as string
  if (changes.url !== undefined && !link(changes.url)) refuse('invalid_arguments', { field: 'url', reason: 'Use a web address.' })
  const now = ctx.now(), fields = Object.keys(changes) as Correctable[]
  const statements: D1PreparedStatement[] = []
  const last = versions[versions.length - 1]
  if (!last || !holdsCurrent(last, row)) {
    const snapshot = currentVersion(row, versions)
    statements.push(ctx.db.prepare("INSERT INTO stump_ledger_versions(id,entry_id,text,note,fields,person_id,agent_id,at,kind) VALUES(?,?,?,?,?,?,?,?,'snapshot')")
      .bind(crypto.randomUUID(), id, snapshot.text, snapshot.note, JSON.stringify(snapshot.fields), snapshot.person_id, snapshot.agent_id, Date.parse(String(snapshot.at))))
  }
  if (fields.length) {
    statements.push(ctx.db.prepare(`UPDATE stump_ledger SET ${fields.map(field => `${field}=?`).join(',')},updated_at=? WHERE id=?`).bind(...fields.map(field => changes[field]), now, id))
  }
  statements.push(ctx.db.prepare("INSERT INTO stump_ledger_versions(id,entry_id,text,note,fields,person_id,agent_id,at,kind) VALUES(?,?,?,?,?,?,?,?,'correction')")
    .bind(crypto.randomUUID(), id, changes.text ?? row.text ?? null, String(args.note).trim(), JSON.stringify(changes), actor(ctx).person_id, actor(ctx).agent_id, Math.max(now, Number(row.updated_at ?? 0))))
  await ctx.db.batch(statements)
  ctx.emit('ledger.corrected', `stump://ledger/${id}`, { fields })
  return (await one(ctx, id)).entry
}

/**
 * The company account and its publisher when removing the entry deletes its post at the network; null when it
 * only records a removal. Only a post the publisher recorded is deleted: an entry whose network id a correction
 * set says which post it refers to, not which post the account wrote, so removing it records the removal only.
 */
export async function networkDelete(ctx: Pick<ActionContext, 'db'>, row: Record<string, unknown>) {
  if (row.route !== 'published' || typeof row.account_id !== 'string' || typeof row.network_id !== 'string') return null
  const account = await readAccount(ctx.db, row.account_id)
  if (account?.owner_kind !== 'company') return null
  const publisher = publishers[account.network]
  if (!publisher) return null
  const corrected = await ctx.db.prepare("SELECT 1 FROM stump_ledger_versions WHERE entry_id=? AND kind='correction' AND json_extract(fields,'$.network_id') IS NOT NULL LIMIT 1")
    .bind(String(row.id)).first()
  return corrected ? null : { account, publisher, network_id: row.network_id }
}

/**
 * A legal hold keeps the post at its network: the company's own delete is refused while a hold stands on any
 * entry of that account recorded for the same post, as an erasure keeps it.
 */
export async function heldAtNetwork(ctx: Pick<ActionContext, 'db'>, row: Record<string, unknown>, target: { account: { id: string }; network_id: string }) {
  const held = await ctx.db.prepare('SELECT id,legal_hold FROM stump_ledger WHERE account_id=? AND network_id=? AND legal_hold IS NOT NULL ORDER BY id=? DESC LIMIT 1')
    .bind(target.account.id, target.network_id, String(row.id)).first<{ id: string; legal_hold: string }>()
  if (!held) return
  const hold = JSON.parse(held.legal_hold) as { reason?: string }
  refuse('conflict', { entry_id: String(row.id), ...held.id === row.id ? {} : { held_entry_id: held.id }, reason: 'The post is under legal hold, so it stays at the network.', legal_hold: hold.reason ?? null })
}

/**
 * What removing an entry computes: deleting the company's own post at its network is
 * destructive and external (the public), one post; recording a removal a venue made is standard.
 */
export async function removalClasses(args: Args, ctx: ActionContext) {
  const { row } = await one(ctx, String(args.entry_id))
  const target = REMOVABLE.includes(String(row.state)) ? await networkDelete(ctx, row) : null
  if (!target) return [{ class: 'standard' as const, facts: { measure: 1 } }]
  await heldAtNetwork(ctx, row, target)
  return [{ class: 'destructive' as const, facts: { measure: 1 } }, { class: 'external' as const, facts: { measure: 1, counterparty: 'public' } }]
}

/**
 * Where the company's own account posted the entry, Stump deletes the post at the network
 * first; a network that refuses leaves the entry as it was, and says why.
 */
async function deleteAtNetwork(ctx: ActionContext, row: Record<string, unknown>): Promise<(RemoveOutcome & { at: string }) | null> {
  const target = await networkDelete(ctx, row)
  if (!target) return null
  await heldAtNetwork(ctx, row, target)
  const { account, publisher, network_id } = target
  const answer = await publisher.remove({ network: account.network, account_id: account.id, network_id }, { db: ctx.db, env: ctx.env, account, prices: await xPrices(ctx.db), now: ctx.now })
  if (answer.outcome === 'failed') refuse('network_refused', { entry_id: String(row.id), network: account.network, outcome: 'failed', message: answer.error ?? 'The network did not delete the post.' })
  return { ...answer, at: new Date(ctx.now()).toISOString() }
}

/**
 * The post came down: a venue's moderators took it down, or the company removes its own.
 * The entry stays on the record, marked removed with the reason; on the company's own
 * account the post is deleted at the network and the outcome kept with the removal.
 */
export async function markRemoved(args: Args, ctx: ActionContext) {
  const id = String(args.entry_id), { row, entry } = await one(ctx, id)
  if (!REMOVABLE.includes(String(row.state))) {
    if (row.state === 'removed') return entry
    refuse('conflict', { entry_id: id, state: row.state, reason: 'Only a post that went out can be marked removed.' })
  }
  const deleted = await deleteAtNetwork(ctx, row)
  const removal = { reason: String(args.reason).trim(), ...actor(ctx), at: new Date(ctx.now()).toISOString(), ...(deleted ? { network_delete: deleted } : {}) }
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
 * Every correction on the ledger, newest first, with who made it, why and the fields
 * it changed. A poster reads only the corrections to their own entries.
 */
export async function corrections(args: Args, ctx: ActionContext) {
  const own = ctx.person.role === 'poster' ? ' AND l.person_id=?' : '', values = [...typeof args.entry_id === 'string' ? [args.entry_id] : [], ...own ? [ctx.person.id] : []]
  const where = `v.kind='correction'${typeof args.entry_id === 'string' ? ' AND v.entry_id=?' : ''}${own}`
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
