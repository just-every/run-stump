import { createAgentDoor, operatorAuthPeople, type PeopleAdapter, type Person, type ToolContext, type Trust } from '../../modules/agent-door/index.ts'
import { operatorAuth, runtimeBindings } from '../../auth.server'
import { doorTool } from '../actions/runner.ts'
import type { ActionContext } from '../actions/types.ts'
import { refuse } from '../actions/refusals.ts'
import type { StumpEnv } from '../env.ts'
import { readPerson, resolvePerson } from '../people/store.ts'
import { stumpTools } from '../tools/index.ts'
import { authenticateCredential, SPECIALIST } from './credentials.ts'
import { baseInvite } from '../people/invite.ts'
import { seal, unseal } from '../accounts/seal.ts'

export const capabilities = ['tools', 'policy', 'pause', 'audit', 'idempotency'] as const
export const toolScopes = () => [...new Set(stumpTools.map(tool => tool.scope))].sort()

/** The Business trust this installation is paired with, or null when its agent policy is local. */
export function agentDoorTrust(env: StumpEnv): Trust | null {
  const issuer = env.RER_OWNER_CLAIM_ISSUER, installationId = env.RER_OWNER_CLAIM_INSTALLATION_ID, keys = env.RER_OWNER_CLAIM_PUBLIC_KEYS
  if (![issuer, installationId, env.RER_OWNER_CLAIM_APP_ORIGIN, keys].some(Boolean)) return null
  if (!issuer || !installationId || !keys) throw new Error('Incomplete agent door trust configuration')
  return { issuer, installationId, appOrigin: env.RER_OWNER_CLAIM_APP_ORIGIN ?? env.AUTH_ORIGIN, publicKeys: JSON.parse(keys) as Trust['publicKeys'] }
}

/**
 * Base people, seen through Stump's team: an operator acts only while they are
 * an active Stump person, with their Stump role. Owners and admins and editors
 * map to the Business roles the policy's approver references name.
 */
export function stumpPeople(env: StumpEnv): PeopleAdapter {
  const base = operatorAuthPeople({ db: env.DB, session: request => operatorAuth(env).getSession(request) })
  const overlay = async (person: Person | null): Promise<Person | null> => {
    if (!person) return null
    const member = person.active ? await resolvePerson(env.DB, { id: person.id, email: person.email, displayName: person.name, role: person.role, status: 'active' }) : null
    return member ? { ...person, name: member.display_name, role: member.role } : { ...person, active: false }
  }
  return {
    person: async id => overlay(await base.person(id)),
    sponsor: async claims => overlay(await base.sponsor(claims)),
    session: async request => overlay(await base.session(request)),
    businessMember: base.businessMember,
    businessRole: person => person.role === 'owner' ? 'owner' : person.role === 'admin' || person.role === 'editor' ? 'editor' : null,
  }
}

/** The native context every Stump action runs with when an agent calls it. */
async function agentContext(env: StumpEnv, toolContext: ToolContext): Promise<ActionContext> {
  const person = await readPerson(env.DB, toolContext.person.id)
  if (!person || person.status !== 'active') refuse('unauthenticated')
  const agent = { id: toolContext.agent.id, name: toolContext.agent.name }
  return {
    db: env.DB, env, person, agent, door: toolContext.door === 'embedded' ? 'embedded' : 'mcp', approvers: toolContext.approvers,
    operationId: toolContext.operationId, now: toolContext.now, emit: toolContext.emit,
    admin: baseInvite(env, operatorAuth(env).delegatedAdministration({ personId: person.id, agentId: agent.id, auditLabel: toolContext.actor.label })),
  }
}

export function stumpAgentDoor(original: StumpEnv) {
  const env = runtimeBindings(original)
  return createAgentDoor({
    seed: 'stump', name: 'Stump', specialist: SPECIALIST, origin: env.AUTH_ORIGIN, db: env.DB, trust: agentDoorTrust(env),
    capabilities: [...capabilities],
    tools: stumpTools.map(tool => doorTool(tool, toolContext => agentContext(env, toolContext))),
    people: stumpPeople(env),
    localCredentials: request => authenticateCredential(env.DB, request, toolScopes()),
    // A key, password or webhook an agent's held call carries waits sealed under the installation key.
    sealing: { seal: (purpose, value) => seal(env, purpose, value), open: (purpose, sealed) => unseal(env, purpose, sealed) },
    notTools: [
      { clauses: ['STUMP-VENUE-004', 'STUMP-IMPORT-001'], reason: 'import-door' },
      { clauses: ['STUMP-INBOX-005'], reason: 'screen' },
      { clauses: ['STUMP-MOBILE-001', 'STUMP-MOBILE-002', 'STUMP-DRAFT-013'], reason: 'device' },
    ],
  })
}

export const AGENT_PATHS = (path: string) => path === '/mcp' || path === '/agents' || path.startsWith('/agents/') || path === '/api/rer/agent-policy' || path.startsWith('/.well-known/oauth-protected-resource')

/** One path scheme (U17): Base's /agents dashboard is Settings · Agents in the app; its approval pages and doors stay at /agents/... */
export function agentsPageRedirect(request: Request): Response | null {
  const url = new URL(request.url)
  if ((url.pathname !== '/agents' && url.pathname !== '/agents/') || !['GET', 'HEAD'].includes(request.method)) return null
  return new Response(null, { status: 302, headers: { location: '/app/settings/agents', 'cache-control': 'no-store' } })
}
