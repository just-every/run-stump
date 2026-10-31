import type { JsonSchema, JsonSchemaObject, ToolContext, ToolDefinition } from '../../modules/agent-door/index.ts'
import { validateSchema } from '../../modules/agent-door/json-schema.ts'
import { BANNED_ACTS, refuse, refuseAct } from './refusals.ts'
import type { ActionContext, Args, StumpAction, StumpTool } from './types.ts'

const ACTION = { type: 'string', minLength: 1, maxLength: 64 } satisfies JsonSchema
/** Arguments every door takes on every call, whether or not the action reads them. */
const DOOR_KEYS = ['idempotency_key', 'expected_revision'] as const
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

/** One action in a few words for an agent reading the schema: "create (needs format; takes text, parts, ...)". */
function actionWords(name: string, action: StumpAction): string {
  const required = action.required ?? [], optional = Object.keys(action.properties ?? {}).filter(key => !required.includes(key))
  const parts = [required.length ? `needs ${required.join(', ')}` : '', optional.length ? `takes ${optional.join(', ')}` : ''].filter(Boolean)
  return parts.length ? `${name} (${parts.join('; ')})` : name
}

/**
 * The tool's one input schema: `action`, naming the actions the tool runs and what each needs, plus every property any action reads.
 * A banned act asked for by name (`like`, `repost`) is outside the list and still answers act_refused, never a schema error:
 * resolveAction reads every call the schema refuses before anything answers it.
 */
export function toolSchema(tool: StumpTool): JsonSchemaObject {
  const names = Object.keys(tool.actions)
  const properties: Record<string, JsonSchema> = {
    action: { ...ACTION, enum: names, description: `What to do: ${names.map(name => actionWords(name, tool.actions[name]!)).join('. ')}.` },
  }
  for (const [name, action] of Object.entries(tool.actions)) {
    for (const [key, schema] of Object.entries(action.properties ?? {})) {
      if (key === 'action' || (DOOR_KEYS as readonly string[]).includes(key)) throw new TypeError(`${tool.name}.${name} declares reserved argument ${key}`)
      if (Object.hasOwn(properties, key) && canonical(properties[key]) !== canonical(schema)) throw new TypeError(`${tool.name} declares ${key} two ways`)
      properties[key] = schema
    }
  }
  // Closed: the agent door refuses an argument no action declares, naming it, before the tool runs.
  return { type: 'object', properties, required: ['action'], additionalProperties: false }
}

/**
 * The action's own arguments, or invalid_arguments naming the first field it
 * does not take, a required field that is missing, or a field whose value its
 * schema refuses. Nothing a caller sends is dropped silently.
 */
function checkArguments(name: string, action: StumpAction, args: Args) {
  const properties = action.properties ?? {}
  for (const key of Object.keys(args)) if (key !== 'action' && !Object.hasOwn(properties, key)) refuse('invalid_arguments', { action: name, field: key, reason: `${name} does not take ${key}.` })
  const missing = (action.required ?? []).find(key => args[key] === undefined)
  if (missing) refuse('invalid_arguments', { action: name, field: missing, reason: `${name} needs ${missing}.` })
  const wrong = Object.keys(args).find(key => key !== 'action' && !validateSchema(properties[key]!, args[key]))
  if (wrong) refuse('invalid_arguments', { action: name, field: wrong })
  const schema: JsonSchemaObject = { type: 'object', properties: { action: ACTION, ...properties }, required: ['action', ...action.required ?? []] }
  if (!validateSchema(schema, args)) refuse('invalid_arguments', { action: name })
}

const widensOwn = (authority: { subject: string; widens: boolean } | null, ctx: ActionContext) =>
  !!authority?.widens && [ctx.person.id, ctx.person.email, ctx.agent?.id].some(id => id?.toLowerCase() === authority.subject.trim().toLowerCase())

/** Whether the person's role runs at least one of the tool's actions. */
const mayUse = (tool: StumpTool, role: ActionContext['person']['role']) => Object.values(tool.actions).some(action => action.roles.includes(role))

/**
 * The action a call names, after the checks every door applies in the same
 * order: a tool outside the person's list (forbidden), refused acts
 * (act_refused with rule and source), unknown actions, an argument naming a
 * banned act and the action's own product rules (act_refused), a call that would widen
 * the caller's own authority (self_escalation, whatever their role or the
 * company policy), the person's role, then the action's own arguments.
 * `args` holds what the caller sent, without idempotency_key and expected_revision.
 */
export async function resolveAction(tool: StumpTool, args: Args, ctx: ActionContext): Promise<StumpAction> {
  if (!mayUse(tool, ctx.person.role)) refuse('forbidden', { tool: tool.name, role: ctx.person.role })
  const name = String(args.action ?? '')
  const action = Object.hasOwn(tool.actions, name) ? tool.actions[name] : undefined
  if (!action) {
    const rule = tool.refused?.[name] ?? (Object.hasOwn(BANNED_ACTS, name) ? BANNED_ACTS[name] : undefined)
    if (rule) await refuseAct(ctx, tool.name, name, rule, { action: name })
    refuse('unknown_action', { action: name, actions: Object.keys(tool.actions) })
  }
  // An argument the action does not take that names a banned act (`auto_reply`, `like`, ...) is that act asked for by name.
  const banned = Object.keys(args).find(key => !Object.hasOwn(action.properties ?? {}, key) && Object.hasOwn(BANNED_ACTS, key))
  if (banned) await refuseAct(ctx, tool.name, name, BANNED_ACTS[banned]!, { action: name, field: banned })
  if (action.refuses) await action.refuses(args, ctx)
  const allowed = action.roles.includes(ctx.person.role)
  if (action.authority) {
    // A record the person may not act on reads as forbidden, never as found or missing.
    const authority = await action.authority(args, ctx).catch(error => { if (!allowed) refuse('forbidden', { action: name, role: ctx.person.role }); throw error })
    if (widensOwn(authority, ctx)) refuse('self_escalation')
  }
  if (!allowed) refuse('forbidden', { action: name, role: ctx.person.role })
  checkArguments(name, action, args)
  return action
}

/** The person door: the same action, arguments, refusals and result as the MCP tool. */
export async function runAsPerson(tool: StumpTool, input: Args, ctx: ActionContext): Promise<unknown> {
  const { idempotency_key: _key, expected_revision: expected, ...args } = input
  const action = await resolveAction(tool, args, ctx)
  if (expected !== undefined && action.revision) {
    const current = await action.revision(args, ctx)
    if (expected !== current) refuse('revision_conflict', { current_revision: current })
  }
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
    // A read action of a tool that also writes reads current records on every call, with or without a key.
    ...(actions.some(action => action.read) && !actions.every(action => action.read)
      ? { readsFor: (args: Args) => { const name = String(args.action ?? ''); return Object.hasOwn(tool.actions, name) && tool.actions[name]!.read === true } } : {}),
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
  tools.filter(tool => mayUse(tool, role)).map(tool => tool.name)
