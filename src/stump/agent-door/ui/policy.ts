// Settings · Agents reads and writes the company's agent policy, Pause and audit
// through Base's own person doors (/agents/api/*), exactly as Base ships them; this
// file holds those calls and the owner's words for classes, answers and outcomes
// (the same words Base's agent pages use, in modules/agent-door/page-words.ts).
import { CATALOGUE, classDefinition, classIds, isClass, type ClassId } from '../../../modules/agent-door/policy/catalogue.ts'
import { ActionError } from '../../ui/api.ts'

export type Disposition = 'autonomous' | 'review' | 'approval' | 'blocked'
export interface PolicyRule { id: string; class: ClassId | '*'; do: Disposition; approver?: string[]; wait?: string; [scope: string]: unknown }
export interface PolicyDocument { schema: string; catalogue: string; rules: PolicyRule[]; reviewers?: string[]; spend?: { none: true } | { caps: unknown[] } }
export interface AgentState { paired: boolean; paused: { business: boolean; local: boolean }; policy: { source: 'business' | 'local'; complete: boolean; unanswered: string[]; spend_caps: string | null } }
export interface ActivityRow { sequence?: number; id: string; at: string; tool: string; agent: { name: string }; sponsor: { name: string }; decision: string; outcome: string; code: string | null; approval: { id: string } | null }
export interface ApprovalItem { id: string; state: string; tool: string; expires_at: string; prepared_by: { agent: string | { name: string }; for: string | { name: string } } }
export interface ReviewItem { id: string; state: string; tool: string; prepared_by: { agent: string | { name: string }; for: string | { name: string } } }

async function door<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) } })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) { const { code, ...fields } = body; throw new ActionError(typeof code === 'string' ? code : 'request_failed', fields, response.status) }
  return body as T
}
export const agentState = () => door<AgentState>('/agents/api/state')
/** The policy as it stands, the latest 20 agent calls (newest first) and this week's counts, for owners, admins and editors (Stump's /app/api/agent-overview). */
export const agentOverview = () => door<{ document: PolicyDocument | null; recent: ActivityRow[]; week: { since: string; counts: Array<{ class: string; decision: string; count: number }> } }>('/app/api/agent-overview')
export const savePolicy = (document: PolicyDocument) => door<{ revision: number; complete: boolean }>('/agents/api/policy', { method: 'PUT', body: JSON.stringify({ document }) })
export const setPaused = (paused: boolean) => door<{ paused: { business: boolean; local: boolean } }>('/agents/api/pause', { method: 'POST', body: JSON.stringify({ paused }) })
export const approvals = () => door<{ approvals: ApprovalItem[] }>('/agents/api/approvals')
export const reviews = () => door<{ reviews: ReviewItem[] }>('/agents/api/reviews')
export const markReview = (id: string, action: 'reviewed' | 'flag') => door<unknown>(`/agents/api/reviews/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' })
/** The owner's answers given so far, kept by Stump until every kind has one and the whole policy goes to Base (policy-answers.ts). */
export const readAnswers = () => door<{ answers: Record<string, Disposition> }>('/app/api/agent-policy/answers')
export const saveAnswer = (cls: string, answer: Disposition) => door<unknown>('/app/api/agent-policy/answers', { method: 'PUT', body: JSON.stringify({ class: cls, answer }) })
export const clearAnswers = () => door<unknown>('/app/api/agent-policy/answers', { method: 'DELETE' })


const CLASS_LABELS: Record<ClassId, string> = {
  standard: 'Everyday work', external: 'Sending outside the company', money: 'Moving money', commitment: 'Commitments',
  accounts: 'Provider accounts', gated: 'Steps a person completes', access: 'Access changes', security: 'Security settings',
  destructive: 'Deleting information', sensitive: 'Sensitive information', live: 'Running services',
}
export const ANSWERS: Record<Disposition, string> = { autonomous: 'Allow', review: 'Allow, then review', approval: 'Ask first', blocked: 'Block' }
const REASONS: Record<string, string> = {
  agents_paused: 'agents were paused', policy_unset: 'no policy answer yet', policy_blocked: 'the policy blocks it', insufficient_scope: 'outside its permissions',
  approval_required: 'it needs approval', approval_expired: 'the request expired', act_refused: 'Stump never does that', rate_limited: 'too many requests',
  execution_failed: 'it failed', unauthenticated: 'it was not signed in',
}
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const words = (key: string) => sentence(key.replace(/[._-]+/g, ' ').trim().toLowerCase())
const DECISIONS: Record<string, string> = { autonomous: 'Allowed', review: 'Allowed, to review', approval: 'Asked first', blocked: 'Blocked', unset: 'No policy yet', none: 'Not decided' }
/** How the policy handled a call, in Base's words (page-words.ts decisionName). */
export const decisionName = (decision: string | null) => DECISIONS[decision ?? 'none'] ?? words(decision ?? 'none')

/** What each kind of action is in Stump, by example, so the line under a kind never only restates its name. */
const CLASS_EXAMPLES: Partial<Record<ClassId, string>> = {
  standard: 'Writing drafts, planning the calendar, keeping brand notes', external: 'Publishing a post, sending to Orbit',
  money: 'Paid X calls when posting or reading replies', accounts: 'Connecting or refreshing a network account',
  gated: 'A venue\'s join step, a network\'s own sign-in', access: 'Inviting a teammate, changing a role',
  security: 'Network app keys, the Orbit and Vane connections', destructive: 'Erasing a person\'s records',
  sensitive: 'Writing samples, press contacts, public handles', live: 'Pausing or resuming the publishing queue',
}
export const className = (cls: string) => cls === '*' ? 'Everything else' : isClass(cls) ? CLASS_LABELS[cls] : words(cls)
export const classHelp = (cls: string) => isClass(cls) ? CLASS_EXAMPLES[cls] ?? classDefinition(cls).when : 'Any kind of action no other answer covers.'
/** Every Stump action's own title by tool name ("Prepare a hand-off for a named member"), from the person door's action list. */
export const toolTitles = () => door<{ titles: Record<string, string> }>('/app/api/actions').then(answer => answer.titles)
/** An action in its own title, the words Base's approval page shows; only a tool Stump no longer has reads as its name in words, as Base does. */
export const actionName = (tool: string, titles: Record<string, string>) => titles[tool] ?? words(tool.replace(/^[^./]+[./]/, ''))
export const principal = (value: string | { name: string }) => typeof value === 'string' ? value : value.name

export function outcomeWords(row: Pick<ActivityRow, 'decision' | 'outcome' | 'code'>): string {
  if (row.code === 'approval_rejected') return 'Declined'
  if (row.outcome === 'refused' || (row.outcome === 'replayed' && row.code)) return `Refused: ${row.code ? REASONS[row.code] ?? words(row.code).toLowerCase() : 'no reason recorded'}`
  if (row.outcome === 'replayed') return 'Result sent to the agent'
  if (row.outcome === 'pending') return 'Waiting for approval'
  if (row.outcome === 'done') return row.decision === 'approval' ? 'Approved and done' : row.decision === 'review' ? 'Done, to review' : 'Done'
  return { running: 'Running', failed: 'Failed' }[row.outcome] ?? words(row.outcome)
}

const unscoped = (rule: PolicyRule) => Object.keys(rule).every(key => ['id', 'class', 'do', 'approver', 'wait'].includes(key))

/** The classes the policy answers, in the catalogue's order: every class the company's actions declare, then a catch-all rule if one exists. */
export function policyClasses(document: PolicyDocument | null, unanswered: readonly string[]): string[] {
  const named = new Set<string>([...unanswered, ...(document?.rules ?? []).filter(rule => rule.class !== '*').map(rule => rule.class)])
  return [...classIds.filter(cls => named.has(cls)), ...[...named].filter(cls => !isClass(cls)), ...(document?.rules.some(rule => rule.class === '*' && unscoped(rule)) ? ['*'] : [])]
}
/** A class's answer: its own unscoped rule, else the catch-all's (as the policy decides it). */
export function answerOf(document: PolicyDocument | null, cls: string): Disposition | '' {
  const rules = (document?.rules ?? []).filter(unscoped)
  return (rules.find(rule => rule.class === cls) ?? (cls === '*' ? undefined : rules.find(rule => rule.class === '*')))?.do ?? ''
}
export const narrower = (document: PolicyDocument | null) => (document?.rules ?? []).filter(rule => !unscoped(rule)).length

/** The draft with one class's own answer set, keeping every other rule; Ask first goes to the owner with a day to answer, as Base's form sets it. */
export function withAnswer(document: PolicyDocument | null, answers: Record<string, Disposition>): PolicyDocument {
  const base: PolicyDocument = document ?? { schema: 'rer-agent-policy/1', catalogue: CATALOGUE, rules: [], reviewers: ['role:owner'], spend: { none: true } }
  let rules = [...base.rules]
  for (const [cls, value] of Object.entries(answers)) {
    const rule: PolicyRule = { id: rules.find(item => item.class === cls && unscoped(item))?.id ?? cls, class: cls as ClassId | '*', do: value, ...(value === 'approval' ? { approver: ['role:owner'], wait: 'P1D' } : {}) }
    rules = rules.some(item => item.class === cls && unscoped(item)) ? rules.map(item => item.class === cls && unscoped(item) ? rule : item) : [...rules, rule]
  }
  return { ...base, rules, reviewers: base.reviewers?.length ? base.reviewers : ['role:owner'], spend: base.spend ?? { none: true } }
}
