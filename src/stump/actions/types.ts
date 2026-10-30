import type { ApprovalSummary, ClassAndFacts, ClassId, JsonSchema, NativeTarget } from '../../modules/agent-door/index.ts'
import type { StumpEnv } from '../env.ts'
import type { StumpPerson } from '../people/store.ts'
import type { Role } from '../people/roles.ts'
import type { RuleSource } from './refusals.ts'

/** Base operator administration, bound to the door the call came through. */
export interface TeamAdmin {
  /** Sends Base's invitation for a new email (an existing operator keeps theirs) and answers the operator id. */
  invite(input: { email: string; displayName: string }): Promise<string>
}

/** What every action handler receives, whichever door the call came through. */
export interface ActionContext {
  readonly db: D1Database
  readonly env: StumpEnv
  /** The person acting, or the person an agent acts for, re-read on every call. */
  readonly person: Readonly<StumpPerson>
  /** The agent, when an agent acts for the person. */
  readonly agent: Readonly<{ id: string; name: string }> | null
  readonly door: 'person' | 'mcp' | 'embedded'
  /** People who approved this exact call under the company policy. */
  readonly approvers: readonly Readonly<{ id: string; name: string }>[]
  readonly operationId: string
  readonly admin: TeamAdmin
  now(): number
  /** Records a change agents can follow (BASE-AGENT-010). */
  emit(type: string, uri: string, data?: Record<string, unknown>): void
}

export type Args = Record<string, unknown>

export interface StumpAction {
  /** Roles that may run this action; an agent has its person's role. */
  roles: readonly Role[]
  /** JSON Schema properties this action reads, and the required ones. */
  properties?: Record<string, JsonSchema>
  required?: string[]
  /** True when the action changes nothing. */
  read?: boolean
  /** The classes and facts of this exact call, computed from records, never from text in the arguments (D-7). */
  classify(args: Args, ctx: ActionContext): ClassAndFacts[] | Promise<ClassAndFacts[]>
  /** What an approver sees: target, recipients, amount, role or items. */
  summary?(args: Args, ctx: ActionContext): ApprovalSummary | Promise<ApprovalSummary>
  /** Access and security actions: whose authority changes and whether it widens. */
  authority?(args: Args, ctx: ActionContext): Promise<{ subject: string; widens: boolean } | null>
  target?(args: Args, ctx: ActionContext): NativeTarget | null | Promise<NativeTarget | null>
  /**
   * Product rules this action meets by what the call asks for (D-1, D-4): checked with the refused acts,
   * before the role and the argument schema, so the call answers act_refused naming its rule (refuseAct).
   */
  refuses?(args: Args, ctx: ActionContext): Promise<void>
  /** The record's current revision; a call with a stale expected_revision answers revision_conflict. */
  revision?(args: Args, ctx: ActionContext): Promise<number | null>
  run(args: Args, ctx: ActionContext): Promise<unknown>
}

/** One tool, declared once, run by the person door and the MCP door alike. */
export interface StumpTool {
  name: string
  title: string
  description: string
  scope: string
  classes: ClassId[]
  clauses: string[]
  actions: Record<string, StumpAction>
  /** Acts this tool never performs, named so a request for one answers act_refused with its rule (D-1, D-4). */
  refused?: Record<string, RuleSource>
}
