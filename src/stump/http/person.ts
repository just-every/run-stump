import { ToolRefusal } from '../../modules/agent-door/index.ts'
import { operatorAuth, runtimeBindings } from '../../auth.server'
import type { ActionContext } from '../actions/types.ts'
import type { StumpEnv } from '../env.ts'
import { baseInvite } from '../people/invite.ts'
import { resolvePerson, type StumpPerson } from '../people/store.ts'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
export const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
export const refusal = (code: string, fields: Record<string, unknown> = {}) => json({ code, ...fields }, STATUS[code] ?? 400)

const STATUS: Record<string, number> = {
  unauthenticated: 401, not_a_member: 403, forbidden: 403, origin_refused: 403, act_refused: 403, self_escalation: 403,
  not_found: 404, unknown_tool: 404, method_not_allowed: 405, revision_conflict: 409, conflict: 409, owner_protected: 409, already_member: 409,
  request_too_large: 413,
}

/** The signed-in Stump person behind a request, or the refusal to send. */
export async function signedIn(request: Request, env: StumpEnv): Promise<{ person: StumpPerson } | { refused: Response }> {
  const session = await operatorAuth(env).getSession(request)
  if (!session) return { refused: refusal('unauthenticated') }
  const person = await resolvePerson(env.DB, session.operator)
  if (!person) return { refused: refusal('not_a_member') }
  // Writes need the exact Origin of this installation (BASE-ACCESS-004).
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== env.AUTH_ORIGIN) return { refused: refusal('origin_refused') }
  return { person }
}

/** The native context for an action a person runs themselves. */
export function personContext(request: Request, original: StumpEnv, person: StumpPerson): ActionContext {
  const env = runtimeBindings(original)
  return {
    db: env.DB, env, person, agent: null, door: 'person', approvers: [], operationId: crypto.randomUUID(), now: Date.now,
    emit() {},
    admin: baseInvite(env, { invite: input => operatorAuth(env).invite(request, input) }),
  }
}

/** A handler's ToolRefusal becomes {code, ...fields} with its status. */
export async function answer(run: () => Promise<Response>): Promise<Response> {
  try { return await run() }
  catch (error) {
    if (error instanceof ToolRefusal) return refusal(error.code, error.details)
    const code = (error as { code?: unknown })?.code, status = (error as { status?: unknown })?.status
    // Base's own refusals (an invitation conflict, a policy denial) keep their code and status.
    if (typeof code === 'string' && typeof status === 'number' && status >= 400 && status < 500) return json({ code }, status)
    throw error
  }
}
