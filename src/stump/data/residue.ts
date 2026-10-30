// Copies of an erased person's data outside Stump's own records (STUMP-DATA-002):
// the agent door's stored call results, approvals and reviews, and the refusal
// record of a product rule. An erasure takes the person out of each: a stored
// result keeps its shape with each record that names them replaced by a marker
// naming the erasure, so a repeated call answers that marker and a write is
// never run twice; a refusal record keeps its rule and ids without their handle
// or address.
import type { D1Sql } from '../../modules/import-kit/src/d1/index.ts'

/** What names the person in a stored copy: ids of their erased records, and their handles or name as words. */
export interface Trace {
  /** Ids of the records the erasure removes, matched exactly. */
  ids: string[]
  /** The person's handles or name as whole words, without case. */
  words: RegExp | null
  /** Lower-case fragments every match contains one of, to find candidate rows. */
  needles: string[]
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** An engager's handles as words: '@alice', 'x.com/alice/status/1' and 'alice' alone, never inside a longer handle. */
export function handleWords(handles: string[]): RegExp | null {
  const forms = new Set<string>()
  for (const handle of handles) {
    forms.add(escape(handle))
    const at = handle.indexOf('@')
    // A Mastodon handle 'user@instance' is also written as the profile address 'instance/@user'.
    if (at > 0) forms.add(`${escape(handle.slice(at + 1))}/@${escape(handle.slice(0, at))}`)
  }
  return forms.size ? new RegExp(`(?<![\\p{L}\\p{N}_.-])@?(?:${[...forms].join('|')})(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`, 'iu') : null
}

const testOf = (trace: Trace, ids = true) => (text: string) => (ids && trace.ids.some(id => text.includes(id))) || (trace.words !== null && trace.words.test(text))

/**
 * A JSON value with each object that names the person replaced by `marker`:
 * an object holding a matching string (directly, or in an array of its own)
 * is that person's record, so it goes whole, with its other fields.
 */
export function redact(value: unknown, names: (text: string) => boolean, marker: unknown): { value: unknown; changed: boolean } {
  let changed = false
  const walk = (item: unknown): { value: unknown; hit: boolean } => {
    if (typeof item === 'string') return { value: item, hit: names(item) }
    if (Array.isArray(item)) {
      const walked = item.map(walk)
      return { value: walked.map(entry => entry.value), hit: walked.some(entry => entry.hit) }
    }
    if (item && typeof item === 'object') {
      const walked = Object.entries(item).map(([key, entry]) => [key, walk(entry)] as const)
      if (walked.some(([, entry]) => entry.hit)) { changed = true; return { value: marker, hit: false } }
      return { value: Object.fromEntries(walked.map(([key, entry]) => [key, entry.value])), hit: false }
    }
    return { value: item, hit: false }
  }
  const top = walk(value)
  if (top.hit) { changed = true; return { value: marker, changed } }
  return { value: top.value, changed }
}

/** Rows of `table` whose `columns` could name the person, read by their key. */
async function candidates(db: D1Database, table: string, key: string[], columns: string[], needles: string[]) {
  if (!needles.length) return []
  const found = new Map<string, Record<string, unknown>>()
  // A few fragments per query keeps each statement's bound values well inside D1's limit.
  for (let index = 0; index < needles.length; index += 20) {
    const chunk = needles.slice(index, index + 20)
    const where = columns.flatMap(column => chunk.map(() => `instr(lower(${column}),?)>0`)).join(' OR ')
    const rows = (await db.prepare(`SELECT ${[...key, ...columns].join(',')} FROM ${table} WHERE ${where}`).bind(...columns.flatMap(() => chunk)).all<Record<string, unknown>>()).results
    for (const row of rows) found.set(JSON.stringify(key.map(column => row[column])), row)
  }
  return [...found.values()]
}

/** The statements that take the person out of the agent door's stored records and the refusal records, with how many rows each changes. */
export async function residueStatements(db: D1Database, trace: Trace, erasureId: string): Promise<{ statements: D1Sql[]; agent_records: number; refusal_records: number }> {
  const marker = { erased: `erasure:${erasureId}` }, names = testOf(trace), named = testOf(trace, false)
  const statements: D1Sql[] = []
  let agent = 0, refusals = 0
  const json = (text: unknown) => JSON.parse(String(text)) as unknown
  // Only what a call carried is redacted (its arguments, summary and result); who prepared or approved it stays.
  const parts = (text: unknown, keys: string[]) => {
    const value = json(text) as Record<string, unknown>
    let changed = false
    for (const key of keys) if (Object.hasOwn(value, key)) { const next = redact(value[key], names, marker); if (next.changed) { value[key] = next.value; changed = true } }
    return { value, changed }
  }
  const RESULT = ['result', 'resources', 'fields']
  for (const row of await candidates(db, 'agent_door_calls', ['agent', 'key'], ['outcome'], trace.needles)) {
    const outcome = parts(row.outcome, RESULT)
    if (!outcome.changed) continue
    agent += 1
    statements.push({ sql: 'UPDATE agent_door_calls SET outcome=? WHERE agent=? AND key=?', params: [JSON.stringify(outcome.value), row.agent, row.key] })
  }
  for (const row of await candidates(db, 'agent_door_approvals', ['id'], ['saved', 'result'], trace.needles)) {
    // An approval waiting for a decision that names the person no longer matches what was asked, so it cannot run.
    const saved = parts(row.saved, ['args', 'summary'])
    const inner = saved.value.result && typeof saved.value.result === 'object' ? parts(JSON.stringify(saved.value.result), RESULT) : null
    if (inner?.changed) saved.value.result = inner.value
    const result = row.result === null ? null : parts(row.result, RESULT)
    if (!saved.changed && !inner?.changed && !result?.changed) continue
    agent += 1
    statements.push({ sql: 'UPDATE agent_door_approvals SET saved=?,result=? WHERE id=?', params: [JSON.stringify(saved.value), result === null ? null : JSON.stringify(result.value), row.id] })
  }
  for (const row of await candidates(db, 'agent_door_reviews', ['id'], ['saved'], trace.needles)) {
    const saved = parts(row.saved, ['summary'])
    if (!saved.changed) continue
    agent += 1
    statements.push({ sql: 'UPDATE agent_door_reviews SET saved=? WHERE id=?', params: [JSON.stringify(saved.value), row.id] })
  }
  for (const row of await candidates(db, 'stump_refusals', ['id'], ['detail'], trace.needles)) {
    // A refusal keeps its rule and the ids it was about; a handle or post address naming the person leaves.
    const detail = json(row.detail) as Record<string, unknown>
    const kept = Object.fromEntries(Object.entries(detail).filter(([, value]) => !(typeof value === 'string' && named(value))))
    if (Object.keys(kept).length === Object.keys(detail).length) continue
    refusals += 1
    statements.push({ sql: 'UPDATE stump_refusals SET detail=? WHERE id=?', params: [JSON.stringify(kept), row.id] })
  }
  return { statements, agent_records: agent, refusal_records: refusals }
}
