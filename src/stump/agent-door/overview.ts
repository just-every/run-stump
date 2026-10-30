// What Settings · Agents shows the people who answer for agents (owner, admin and editor, Base's "owner" and
// "editor"): the company's agent policy as it stands, and this week's agent calls by kind of action and how the
// policy handled them. Stump's app replaces Base's /agents page (agentsPageRedirect), so this reads Base's agent
// door tables exactly as that page does (src/modules/agent-door/policy-store.ts policyState, pages.ts dashboard).
import type { StumpEnv } from '../env.ts'
import { agentDoorTrust } from './index.ts'

export interface WeekCount { class: string; decision: string; count: number }
export interface AgentOverview { document: unknown; week: { since: string; counts: WeekCount[] } }

/** Monday 00:00 UTC of the week holding `now`, as Base's dashboard counts it. */
export function weekStart(now: number): number {
  const today = Math.floor(now / 86400000)
  return (today - (new Date(now).getUTCDay() + 6) % 7) * 86400000
}

export async function agentOverview(env: StumpEnv, now: number): Promise<AgentOverview> {
  const business = agentDoorTrust(env) !== null
  const row = await env.DB.prepare('SELECT envelope, local_document FROM agent_door_state WHERE id=1').first<{ envelope: string | null; local_document: string | null }>()
  const source = business ? row?.envelope : row?.local_document
  const parsed = source ? JSON.parse(source) as Record<string, unknown> : null
  const document = business ? parsed?.document ?? null : parsed
  const since = weekStart(now)
  const counts = await env.DB.prepare("SELECT c.value AS class, json_extract(a.row,'$.decision') AS decision, count(*) AS count FROM agent_door_audit a, json_each(a.classes) c WHERE a.at>=? AND a.at<=? GROUP BY c.value, json_extract(a.row,'$.decision') ORDER BY c.value, decision")
    .bind(new Date(since).toISOString(), new Date(now).toISOString()).all<WeekCount>()
  return { document, week: { since: new Date(since).toISOString(), counts: counts.results.filter(item => item.count > 0) } }
}
