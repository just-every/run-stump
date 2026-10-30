import type { StumpEnv } from '../env.ts'
import { open, seal } from './seal.ts'

export type Seed = 'orbit' | 'vane'
export const SEEDS: readonly Seed[] = ['orbit', 'vane']

interface ConnectionRow {
  seed: Seed; origin: string; external_id: string; secret_sealed: string; state: 'connected' | 'disconnected'
  connected_by: string; connected_at: number; disconnected_at: number | null; last_sent_at: number | null; last_error: string | null
}

const iso = (at: number | null) => at === null ? null : new Date(at).toISOString()
const binding = (seed: Seed, origin: string, id: string) => `stump-stack|${seed}|${origin}|${id}`

/** What the doors show of a connection: never the secret. */
export interface ConnectionView {
  seed: Seed; origin: string; source_id?: string; site_id?: string; state: 'connected' | 'disconnected'; secret_set: boolean
  connected_by: string; connected_at: string | null; disconnected_at: string | null; last_sent_at: string | null; last_error: string | null
}

export function publicConnection(row: ConnectionRow): ConnectionView {
  return { seed: row.seed, origin: row.origin, ...(row.seed === 'orbit' ? { source_id: row.external_id } : { site_id: row.external_id }), state: row.state, secret_set: row.state === 'connected',
    connected_by: row.connected_by, connected_at: iso(row.connected_at), disconnected_at: iso(row.disconnected_at), last_sent_at: iso(row.last_sent_at), last_error: row.last_error }
}

export async function listConnections(db: D1Database) {
  return (await db.prepare('SELECT * FROM stump_stack_connections ORDER BY seed').all<ConnectionRow>()).results.map(publicConnection)
}

export async function readConnection(db: D1Database, seed: Seed): Promise<ConnectionRow | null> {
  return db.prepare('SELECT * FROM stump_stack_connections WHERE seed=?').bind(seed).first<ConnectionRow>()
}

export async function saveConnection(env: StumpEnv, input: { seed: Seed; origin: string; id: string; secret: string; by: string; now: number }) {
  const sealed = await seal(env, binding(input.seed, input.origin, input.id), input.secret)
  await env.DB.prepare(`INSERT INTO stump_stack_connections(seed,origin,external_id,secret_sealed,state,connected_by,connected_at,disconnected_at,last_sent_at,last_error)
    VALUES(?,?,?,?,'connected',?,?,NULL,NULL,NULL) ON CONFLICT(seed) DO UPDATE SET origin=excluded.origin,external_id=excluded.external_id,secret_sealed=excluded.secret_sealed,
    state='connected',connected_by=excluded.connected_by,connected_at=excluded.connected_at,disconnected_at=NULL,last_sent_at=NULL,last_error=NULL`)
    .bind(input.seed, input.origin, input.id, sealed, input.by, input.now).run()
  return publicConnection((await readConnection(env.DB, input.seed))!)
}

/** Disconnecting stops every send and drops the sealed secret; connecting again needs it again. */
export async function dropConnection(db: D1Database, seed: Seed, now: number) {
  await db.prepare("UPDATE stump_stack_connections SET state='disconnected',disconnected_at=?,secret_sealed='' WHERE seed=? AND state='connected'").bind(now, seed).run()
  const row = await readConnection(db, seed)
  return row ? publicConnection(row) : null
}

export async function secretOf(env: StumpEnv, row: ConnectionRow): Promise<string> {
  return open(env, binding(row.seed, row.origin, row.external_id), row.secret_sealed)
}

export async function noteSend(db: D1Database, seed: Seed, now: number, error: string | null) {
  await db.prepare('UPDATE stump_stack_connections SET last_sent_at=?,last_error=? WHERE seed=?').bind(now, error, seed).run()
}
export type { ConnectionRow }
