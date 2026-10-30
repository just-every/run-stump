// The owner's agent-policy answers given so far (Settings · Agents, L15). Base's
// /agents/api/policy takes only a complete policy, so each answer saves here as it
// changes; agents keep waiting on Base's own policy until every kind has an answer,
// when the screen sends the whole policy to Base and clears these rows. Owner only,
// through the person door: an agent never reads or writes them.
import { isClass } from '../../modules/agent-door/policy/catalogue.ts'
import { json, refusal } from '../http/person.ts'
import type { StumpPerson } from '../people/store.ts'

const ANSWERS = ['autonomous', 'review', 'approval', 'blocked'] as const

export async function policyAnswersResponse(request: Request, db: D1Database, person: StumpPerson): Promise<Response> {
  if (person.role !== 'owner') return refusal('forbidden')
  if (request.method === 'GET') {
    const rows = (await db.prepare('SELECT class,answer FROM stump_agent_policy_answers ORDER BY class').all<{ class: string; answer: string }>()).results
    return json({ answers: Object.fromEntries(rows.map(row => [row.class, row.answer])) })
  }
  if (request.method === 'DELETE') {
    await db.prepare('DELETE FROM stump_agent_policy_answers').run()
    return json({ answers: {} })
  }
  if (request.method !== 'PUT') return refusal('method_not_allowed')
  let input: { class?: unknown; answer?: unknown }
  try { input = await request.json() } catch { return refusal('invalid_arguments') }
  const cls = input?.class, answer = input?.answer
  if (typeof cls !== 'string' || !(isClass(cls) || cls === '*')) return refusal('invalid_arguments', { field: 'class' })
  if (typeof answer !== 'string' || !(ANSWERS as readonly string[]).includes(answer)) return refusal('invalid_arguments', { field: 'answer' })
  await db.prepare('INSERT INTO stump_agent_policy_answers(class,answer,updated_at) VALUES(?,?,?) ON CONFLICT(class) DO UPDATE SET answer=excluded.answer,updated_at=excluded.updated_at')
    .bind(cls, answer, Date.now()).run()
  return json({ class: cls, answer })
}
