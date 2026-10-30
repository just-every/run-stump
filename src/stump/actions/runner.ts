import type { JsonSchema, JsonSchemaObject, ToolContext, ToolDefinition } from '../../modules/agent-door/index.ts'
import { validateSchema } from '../../modules/agent-door/json-schema.ts'
import { BANNED_ACTS, refuse, refuseAct } from './refusals.ts'
import type { ActionContext, Args, StumpAction, StumpTool } from './types.ts'

const ACTION: JsonSchema = { type: 'string', minLength: 1, maxLength: 64 }
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

/** The tool's one input schema: `action` plus every property any action reads. */
export function toolSchema(tool: StumpTool): JsonSchemaObject {
  const properties: Record<string, JsonSchema> = { action: ACTION }
  for (const [name, action] of Object.entries(tool.actions)) {
    for (const [key, schema] of Object.entries(action.properties ?? {})) {
      if (key === 'action' || key === 'idempotency_key' || key === 'expected_revision') throw new TypeError(`${tool.name}.${name} declares reserved argument ${key}`)
      if (Object.hasOwn(properties, key) && canonical(properties[key]) !== canonical(schema)) throw new TypeError(`${tool.name} declares ${key} two ways`)
      properties[key] = schema
    }
  }
  return { type: 'object', properties, required: ['action'] }
}

function actionSchema(action: StumpAction): JsonSchemaObject {
  return { type: 'object', properties: { action: ACTION, ...action.properties }, required: ['action', ...action.required ?? []] }
}

/** Only declared arguments reach a handler, through either door. */
export function declaredArgs(tool: StumpTool, input: Args): Args {
  const properties = toolSchema(tool).properties ?? {}
  return Object.fromEntries(Object.entries(input).filter(([key]) => Object.hasOwn(properties, key)))
}

/**
 * The action a call names, after the checks every door applies in the same
 * order: refused acts (act_refused with rule and source), unknown actions, the
 * person's role, then the action's own argument schema.
 */
export async function resolveAction(tool: StumpTool, args: Args, ctx: ActionContext): Promise<StumpAction> {
  const name = String(args.action ?? '')
  const action = Object.hasOwn(tool.actions, name) ? tool.actions[name] : undefined
  if (!action) {
    const rule = tool.refused?.[name] ?? (Object.hasOwn(BANNED_ACTS, name) ? BANNED_ACTS[name] : undefined)
    if (rule) await refuseAct(ctx, tool.name, name, rule, { action: name })
    refuse('unknown_action', { action: name, actions: Object.keys(tool.actions) })
  }
  if (!action.roles.includes(ctx.person.role)) refuse('forbidden', { action: name, role: ctx.person.role })
  if (!validateSchema(actionSchema(action), args)) refuse('invalid_arguments', { action: name })
  return action
}

const widensOwn = (authority: { subject: string; widens: boolean } | null, ctx: ActionContext) =>
  !!authority?.widens && [ctx.person.id, ctx.person.email, ctx.agent?.id].some(id => id?.toLowerCase() === authority.subject.trim().toLowerCase())

/** The person door: the same action, arguments, refusals and result as the MCP tool. */
export async function runAsPerson(tool: StumpTool, input: Args, ctx: ActionContext): Promise<unknown> {
  const args = declaredArgs(tool, input)
  const action = await resolveAction(tool, args, ctx)
  if (input.expected_revision !== undefined && action.revision) {
    const current = await action.revision(args, ctx)
    if (input.expected_revision !== current) refuse('revision_conflict', { current_revision: current })
  }
  if (widensOwn(action.authority ? await action.authority(args, ctx) : null, ctx)) refuse('self_escalation')
  await action.classify(args, ctx)
  return action.run(args, ctx)
}

/** The MCP door: the Base agent door runs this definition through its policy, approval, idempotency, Pause and audit. */
export function doorTool(tool: StumpTool, context: (ctx: ToolContext) => Promise<ActionContext>): ToolDefinition {
  const actions = Object.values(tool.actions)
  const resolved = async (args: Args, toolContext: ToolContext) => {
    const ctx = await context(toolContext)
    return { ctx, action: await resolveAction(tool, args, ctx) }
  }
  const governs = tool.classes.some(cls => cls === 'access' || cls === 'security')
  return {
    name: tool.name, title: tool.title, description: tool.description, scope: tool.scope, clauses: tool.clauses, classes: tool.classes,
    readOnly: actions.every(action => action.read), inputSchema: toolSchema(tool), outputSchema: { type: 'object' },
    async classify(args, toolContext) { const { ctx, action } = await resolved(args, toolContext); return action.classify(args, ctx) },
    async summary(args, toolContext) {
      const { ctx, action } = await resolved(args, toolContext)
      return action.summary ? action.summary(args, ctx) : { target: { name: `${tool.name} ${String(args.action)}` } }
    },
    async target(args, toolContext) { const { ctx, action } = await resolved(args, toolContext); return action.target ? action.target(args, ctx) : null },
    ...(governs ? { async authority(args: Args, toolContext: ToolContext) { const { ctx, action } = await resolved(args, toolContext); return action.authority ? action.authority(args, ctx) : null } } : {}),
    ...(actions.some(action => action.revision) ? { async revision(args: Args, toolContext: ToolContext) { const { ctx, action } = await resolved(args, toolContext); return action.revision ? action.revision(args, ctx) : null } } : {}),
    async run(args, toolContext) { const { ctx, action } = await resolved(args, toolContext); return { result: await action.run(args, ctx) } },
  }
}

/** The tool names a person may run: those with at least one action their role allows. */
export const allowedTools = (tools: readonly StumpTool[], role: ActionContext['person']['role']) =>
  tools.filter(tool => Object.values(tool.actions).some(action => action.roles.includes(role))).map(tool => tool.name)
