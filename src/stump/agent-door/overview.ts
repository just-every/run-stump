// What Settings · Agents shows the people who answer for agents (owner, admin and editor, Base's "owner" and
// "editor"): the company's agent policy as it stands, the latest agent calls, and this week's agent calls by kind
// of action and how the policy handled them. Stump's app replaces Base's /agents page (agentsPageRedirect), so this
// reads Base's agent door tables exactly as that page does (src/modules/agent-door/policy-store.ts policyState,
// pages.ts dashboard): one query each, whatever the number of calls ever made.
//
// Both views count calls, not audit rows. A call that waited for approval has two rows sharing its approval id (pending, then
// what came of it), so the pending row of a decided call is left out. The week counts each call once, under the kind of action
// whose answer decided it (the first class in catalogue order whose rule gave the call's decision, as Base's decide names it), so
// a kind the policy allows never reads "Asked first" because the same call also had a gated step.
import type { StumpEnv } from '../env.ts'
import type { AuditRow } from '../../modules/agent-door/audit.ts'
import { classIds } from '../../modules/agent-door/policy/catalogue.ts'
import { agentDoorTrust } from './index.ts'

export interface WeekCount { class: string; decision: string; count: number }
export interface AgentOverview { document: unknown; recent: AuditRow[]; week: { since: string; counts: WeekCount[] } }
/** How many of the latest agent calls the page lists, as Base's dashboard does. */
export const RECENT_LIMIT = 20

/** Monday 00:00 UTC of the week holding `now`, as Base's dashboard counts it. */
export function weekStart(now: number): number {
  const today = Math.floor(now / 86400000)
  return (today - (new Date(now).getUTCDay() + 6) % 7) * 86400000
}

/** An audit row that is not the pending row of a call whose approval has since been decided (a later row carries the same approval). */
const DECIDED = `NOT (json_extract(a.row,'$.outcome')='pending' AND EXISTS (SELECT 1 FROM agent_door_audit b WHERE b.sequence>a.sequence
  AND json_extract(b.row,'$.approval.id')=json_extract(a.row,'$.approval.id')))`

export async function agentOverview(env: StumpEnv, now: number): Promise<AgentOverview> {
  const business = agentDoorTrust(env) !== null
  const row = await env.DB.prepare('SELECT envelope, local_document FROM agent_door_state WHERE id=1').first<{ envelope: string | null; local_document: string | null }>()
  const source = business ? row?.envelope : row?.local_document
  const parsed = source ? JSON.parse(source) as Record<string, unknown> : null
  const document = business ? parsed?.document ?? null : parsed
  const since = weekStart(now)
  const [counts, recent] = await Promise.all([env.DB.prepare(`SELECT class, decision, count(*) AS count FROM (
      SELECT json_extract(a.row,'$.decision') AS decision, (SELECT json_extract(r.value,'$.class') FROM json_each(a.row,'$.rules') r JOIN json_each(?3) k ON k.value=json_extract(r.value,'$.class')
        WHERE json_extract(r.value,'$.do')=json_extract(a.row,'$.decision') ORDER BY k.key LIMIT 1) AS class
      FROM agent_door_audit a WHERE a.at>=?1 AND a.at<=?2 AND ${DECIDED})
    WHERE class IS NOT NULL GROUP BY class, decision ORDER BY class, decision`)
    .bind(new Date(since).toISOString(), new Date(now).toISOString(), JSON.stringify(classIds)).all<WeekCount>(),
    env.DB.prepare(`SELECT a.sequence, a.row FROM agent_door_audit a WHERE ${DECIDED} ORDER BY a.sequence DESC LIMIT ?`).bind(RECENT_LIMIT).all<{ sequence: number; row: string }>()])
  return { document, recent: recent.results.map(record => ({ ...JSON.parse(record.row) as AuditRow, sequence: record.sequence })), week: { since: new Date(since).toISOString(), counts: counts.results.filter(item => item.count > 0) } }
}
