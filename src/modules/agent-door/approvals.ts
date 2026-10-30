import type { Evidence } from './audit.ts'
import { recoverAudit } from './audit.ts'
import type { ClassAndFacts, CallResult, JsonSchema, Person, Principal, Runtime, ToolContext, ToolDefinition, ApprovalDisplaySummary } from './types.ts'
import { appendEvents } from './events.ts'
import { error, json, ToolRefusal } from './errors.ts'
import { matchingRefs, preparedBy } from './people.ts'
import { executeApproval } from './approval-execution.ts'

export interface SavedApproval {
  decision_id: string; revision: number | null; tool: string; args: Record<string, unknown>; digest: string; key: string | null; claimKey?: string | null
  classes: ClassAndFacts[]; principal: Principal; approvers: string[]; expires_at: string; door: ToolContext['door']; evidence: Evidence
  result: CallResult; expected_revision?: string | number; summary: ApprovalDisplaySummary; summary_sha256: string
  /** The writeOnly arguments, sealed for this decision, until the approval reaches a final state. */
  sealed?: string
}
interface ApprovalRecord { id: string; state: string; saved: string; approvals: string; result: string | null; version: number }
export interface ApprovalMark { ref: string; person: string; name: string; at: string }

type Node = Record<string, unknown>
const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && !Array.isArray(value)
/** Paths to the properties a schema marks writeOnly: secrets a tool takes and never answers. */
function secretPaths(schema: JsonSchema, at: string[] = []): string[][] {
  if (!isNode(schema) || !isNode(schema.properties)) return []
  return Object.entries(schema.properties).flatMap(([key, child]) => isNode(child) && child.writeOnly === true ? [[...at, key]] : secretPaths(child as JsonSchema, [...at, key]))
}
/**
 * A held call's arguments as its approval keeps them: every writeOnly value moves into
 * one value sealed for this decision, and the arguments keep the rest.
 */
export async function sealArguments(rt: Runtime, tool: ToolDefinition, args: Record<string, unknown>, decisionId: string): Promise<{ args: Record<string, unknown>; sealed?: string }> {
  const kept = structuredClone(args), secrets: Array<[string[], unknown]> = []
  for (const path of secretPaths(tool.inputSchema)) {
    const parent = path.slice(0, -1).reduce<unknown>((node, key) => isNode(node) ? node[key] : undefined, kept), key = path.at(-1)!
    if (isNode(parent) && Object.hasOwn(parent, key)) { secrets.push([path, parent[key]]); delete parent[key] }
  }
  if (!secrets.length) return { args }
  if (!rt.options.sealing) throw new ToolRefusal('sealing_unavailable')
  return { args: kept, sealed: await rt.options.sealing.seal(`approval:${decisionId}`, secrets) }
}
/** The arguments a held call runs with: what the approval kept, with its sealed values opened. */
export async function openArguments(rt: Runtime, saved: SavedApproval): Promise<Record<string, unknown>> {
  if (saved.sealed === undefined) return saved.args
  if (!rt.options.sealing) throw new Error('sealing_unavailable')
  const args = structuredClone(saved.args), secrets = await rt.options.sealing.open(`approval:${saved.decision_id}`, saved.sealed) as Array<[string[], unknown]>
  for (const [path, value] of secrets) {
    let node: Node = args
    for (const key of path.slice(0, -1)) { if (!isNode(node[key])) node[key] = {}; node = node[key] as Node }
    node[path.at(-1)!] = value
  }
  return args
}
/** SQL that drops a decided approval's sealed arguments: nothing runs with them again. */
export const DROP_SEALED = "saved=json_remove(saved,'$.sealed')"
export async function openApproval(rt: Runtime, saved: SavedApproval) {
  const id = crypto.randomUUID(), requestState = crypto.randomUUID()
  const approval = { id, url: `${rt.options.origin}/agents/approvals/${id}`, expires_at: saved.expires_at }
  saved.result = { ...saved.result, outcome: 'pending', approval, requestState }
  await rt.options.db.prepare('INSERT INTO agent_door_approvals(id,state,saved) VALUES(?,?,?)').bind(id, 'pending', JSON.stringify(saved)).run()
  return saved.result
}
export async function approvalReplay(rt: Runtime, result: CallResult): Promise<CallResult> {
  if (!result.approval) return result
  const row = await rt.options.db.prepare('SELECT * FROM agent_door_approvals WHERE id=?').bind(result.approval.id).first<ApprovalRecord>()
  if (!row) return { ...result, outcome: 'refused', code: 'approval_expired' }
  const saved: SavedApproval = JSON.parse(row.saved)
  if (row.result) {
    const completed: CallResult = JSON.parse(row.result)
    if (completed.execution_id) await recoverAudit(rt, completed.execution_id, completed)
    return completed
  }
  if (row.state === 'rejected') return { ...result, outcome: 'refused', code: 'approval_rejected' }
  if (row.state === 'expired' || rt.now() >= Date.parse(saved.expires_at)) return { ...result, outcome: 'refused', code: 'approval_expired' }
  return result
}
export function approvalView(rt: Runtime, row: ApprovalRecord) {
  const saved: SavedApproval = JSON.parse(row.saved)
  return { id: row.id, decision_id: saved.decision_id, revision: saved.revision, state: row.state === 'pending' && rt.now() >= Date.parse(saved.expires_at) ? 'expired' : row.state === 'executing' ? 'pending' : row.state,
    code: row.result ? JSON.parse(row.result).code ?? null : null, summary: saved.summary, summary_sha256: saved.summary_sha256,
    tool: saved.tool, classes: saved.classes, approvers: saved.approvers, approvals: JSON.parse(row.approvals), expires_at: saved.expires_at,
    prepared_by: preparedBy(saved.principal), rules: saved.result.decision?.classes.map(({ class: cls, rule, do: action }) => ({ class: cls, rule, do: action })) }
}
export const canReadApproval = async (rt: Runtime, person: Person, saved: SavedApproval) => person.id === saved.principal.person.id || (await matchingRefs(rt, person, saved.principal.person.id, saved.approvers)).length > 0
export async function approvalDoor(rt: Runtime, request: Request, person: Person, id?: string, action?: string): Promise<Response> {
  if (!id) {
    if (request.method !== 'GET') return error('method_not_allowed', 405)
    const rows = (await rt.options.db.prepare('SELECT * FROM agent_door_approvals ORDER BY rowid DESC LIMIT 200').all<ApprovalRecord>()).results
    const visible = await Promise.all(rows.map(async row => await canReadApproval(rt, person, JSON.parse(row.saved)) ? approvalView(rt, row) : null))
    return json({ approvals: visible.filter(row => row !== null) })
  }
  const row = await rt.options.db.prepare('SELECT * FROM agent_door_approvals WHERE id=?').bind(id).first<ApprovalRecord>()
  if (!row) return error('not_found', 404)
  const saved: SavedApproval = JSON.parse(row.saved)
  if (!await canReadApproval(rt, person, saved)) return error('forbidden', 403)
  if (request.method === 'GET' && !action) return json({ approval: approvalView(rt, row) })
  if (request.method !== 'POST' || !['approve', 'reject'].includes(action ?? '')) return error('method_not_allowed', 405)
  let body: { revision?: unknown; summary_sha256?: unknown }
  try { body = await request.json() } catch { return error('invalid_arguments') }
  if (body.summary_sha256 !== saved.summary_sha256) return error('approval_summary_mismatch', 409)
  if (body.revision !== saved.revision) return error('revision_conflict', 409, { current_revision: saved.revision })
  if (row.state === 'expired' || rt.now() >= Date.parse(saved.expires_at) && row.state === 'pending') {
    await rt.options.db.prepare(`UPDATE agent_door_approvals SET state='expired',${DROP_SEALED} WHERE id=? AND state='pending'`).bind(id).run()
    return error('approval_expired', 409)
  }
  const approvals: ApprovalMark[] = JSON.parse(row.approvals)
  const refs = await matchingRefs(rt, person, saved.principal.person.id, saved.approvers)
  if (!refs.length) return error('forbidden', 403)
  if (row.state !== 'pending') return json({ approval: approvalView(rt, row) })
  const unsatisfied = refs.filter(ref => !approvals.some(mark => mark.ref === ref))
  if (!unsatisfied.length) return json({ approval: approvalView(rt, row) })
  if (action === 'approve') approvals.push(...unsatisfied.map(ref => ({ ref, person: person.id, name: person.name, at: new Date(rt.now()).toISOString() })))
  const complete = action === 'approve' && saved.approvers.every(ref => approvals.some(mark => mark.ref === ref))
  const nextState = action === 'reject' ? 'rejected' : complete ? 'executing' : 'pending'
  const changed = await rt.options.db.prepare(`UPDATE agent_door_approvals SET state=?,approvals=?,version=version+1${nextState === 'rejected' ? `,${DROP_SEALED}` : ''} WHERE id=? AND version=? AND state=?`)
    .bind(nextState, JSON.stringify(approvals), id, row.version, 'pending').run()
  if (!changed.meta.changes) return error('approval_conflict', 409)
  const final = complete ? await executeApproval(rt, id, saved, approvals) : { state: nextState, code: undefined }
  await appendEvents(rt, [{ type: 'approval.decided', uri: `${rt.options.origin}/agents/approvals/${id}`, actor: { kind: 'person', person: { id: person.id, name: person.name } }, data: { decision_id: saved.decision_id, classes: saved.classes, decision: 'approval', state: final.state, ...(final.code ? { code: final.code } : {}) } }])
  const current = (await rt.options.db.prepare('SELECT * FROM agent_door_approvals WHERE id=?').bind(id).first<ApprovalRecord>())!
  return json({ approval: approvalView(rt, current) })
}
