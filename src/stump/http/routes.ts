import { runtimeBindings } from '../../auth.server'
import { allowedTools, runAsPerson } from '../actions/runner.ts'
import { issueCredential, listCredentials, revokeCredential } from '../agent-door/credentials.ts'
import { policyAnswersResponse } from '../agent-door/policy-answers.ts'
import type { StumpEnv } from '../env.ts'
import { stumpTools } from '../tools/index.ts'
import { answer, json, personContext, refusal, signedIn } from './person.ts'

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

/**
 * The person door under /app/api: the UI's own actions, run as the signed-in
 * person with the same arguments, results and refusal codes as the MCP tools,
 * and the agent credentials a person issues for their own agent.
 */
export async function personDoorResponse(request: Request, original: StumpEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (!path.startsWith('/app/api/')) return null
  const env = runtimeBindings(original)
  const who = await signedIn(request, env)
  if ('refused' in who) return who.refused
  const { person } = who
  return answer(async () => {
    if (path === '/app/api/me') {
      if (request.method !== 'GET') return refusal('method_not_allowed')
      return json({ person: { id: person.id, email: person.email, display_name: person.display_name, role: person.role, connection: person.connection }, actions: allowedTools(stumpTools, person.role) })
    }
    if (path === '/app/api/actions') {
      if (request.method !== 'GET') return refusal('method_not_allowed')
      return json({ actions: allowedTools(stumpTools, person.role) })
    }
    const action = /^\/app\/api\/actions\/([a-z0-9._-]+)$/.exec(path)
    if (action) {
      if (request.method !== 'POST') return refusal('method_not_allowed')
      const tool = stumpTools.find(item => item.name === action[1])
      if (!tool) return refusal('unknown_tool', { tool: action[1] })
      const args = await body(request)
      if (!args) return refusal('invalid_arguments')
      return json({ result: await runAsPerson(tool, args, personContext(request, env, person)) })
    }
    if (path === '/app/api/agent-credentials') {
      if (request.method === 'GET') {
        const admin = person.role === 'owner' || person.role === 'admin'
        const items = (await listCredentials(env.DB, admin ? null : person.id)).map(row => ({ client_id: row.client_id, name: row.name, person_id: row.person_id,
          created_at: new Date(row.created_at).toISOString(), revoked_at: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString() }))
        return json({ items, total: items.length })
      }
      if (request.method !== 'POST') return refusal('method_not_allowed')
      const input = await body(request), name = typeof input?.name === 'string' ? input.name.trim() : ''
      if (!name || name.length > 80) return refusal('invalid_arguments', { field: 'name' })
      return json(await issueCredential(env.DB, person.id, name), 201)
    }
    if (path === '/app/api/agent-policy/answers') return policyAnswersResponse(request, env.DB, person)
    const revoke = /^\/app\/api\/agent-credentials\/([A-Za-z0-9_-]{1,80})\/revoke$/.exec(path)
    if (revoke) {
      if (request.method !== 'POST') return refusal('method_not_allowed')
      const owner = await env.DB.prepare('SELECT person_id FROM stump_agent_credentials WHERE client_id=?').bind(revoke[1]).first<{ person_id: string }>()
      if (!owner) return refusal('not_found', { client_id: revoke[1] })
      // A person revokes their own agents; owners and admins revoke anyone's.
      if (owner.person_id !== person.id && person.role !== 'owner' && person.role !== 'admin') return refusal('forbidden')
      await revokeCredential(env.DB, revoke[1]!)
      return json({ client_id: revoke[1], revoked: true })
    }
    return refusal('not_found')
  })
}
