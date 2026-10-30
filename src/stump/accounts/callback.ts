import { ToolRefusal } from '../../modules/agent-door/index.ts'
import { runtimeBindings } from '../../auth.server'
import { runAsPerson } from '../actions/runner.ts'
import type { StumpEnv } from '../env.ts'
import { personContext, signedIn } from '../http/person.ts'
import { accountTools } from '../tools/accounts.ts'
import { NETWORKS } from './apps.ts'
import { digest } from './seal.ts'

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
const CALLBACK = new RegExp(`^/app/connected/(${NETWORKS.join('|')})/?$`)
const tool = accountTools.find(item => item.name === 'stump.accounts.connect')!

/**
 * Where a network's consent screen sends the person back. The server finishes
 * the connection as the signed-in person who started it, records what happened
 * on the consent, and sends the browser on to the same page without the code,
 * so a reload or the history never repeats it (STUMP-PUBLISH-001.4).
 */
export async function consentCallback(request: Request, original: StumpEnv): Promise<Response | null> {
  const url = new URL(request.url), match = CALLBACK.exec(url.pathname)
  if (!match || request.method !== 'GET') return null
  const query = url.searchParams, network = match[1]!
  if (!query.has('state') && !query.has('code') && !query.has('error')) return null
  const env = runtimeBindings(original)
  const who = await signedIn(request, env)
  if ('refused' in who) return who.refused
  const ctx = personContext(request, env, who.person)
  const args: Record<string, unknown> = { action: 'complete' }
  for (const name of ['state', 'code', 'iss', 'error'] as const) { const value = query.get(name); if (value) args[name] = value }
  const state = query.get('state')
  const row = state ? await env.DB.prepare('SELECT id,network,person_id FROM stump_connections WHERE state_hash=?').bind(await digest(state)).first<{ id: string; network: string; person_id: string }>() : null
  const own = row && row.person_id === who.person.id ? row : null
  const back = (fields: Record<string, string>) => new Response(null, { status: 303, headers: { ...headers, location: `/app/connected/${network}?${new URLSearchParams(fields)}` } })
  if (own && own.network !== network) return back({ refused: 'network_mismatch' })
  let outcome: Record<string, unknown>
  try {
    const done = await runAsPerson(tool, args, ctx) as { account: { id: string } }
    outcome = { ok: true, account_id: done.account.id }
  } catch (error) {
    if (!(error instanceof ToolRefusal)) throw error
    outcome = { ok: false, code: error.code, ...error.details }
  }
  if (!own) return back({ refused: String(outcome.code ?? 'not_found') })
  // A reload of a finished consent keeps what it first answered.
  await env.DB.prepare("UPDATE stump_connections SET outcome=? WHERE id=? AND (outcome IS NULL OR json_extract(outcome,'$.ok')<>1)").bind(JSON.stringify(outcome), own.id).run()
  return back({ connection: own.id })
}
