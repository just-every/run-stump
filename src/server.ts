import { withDemo } from './modules/demo/index.mjs'
import { rejectedResponse } from './base/rejected-response'
import start from '@tanstack/react-start/server-entry'
import { Hono } from 'hono'
import { dispatch } from './base/dispatch'
import { staticAssetResponse } from './base/static-assets'
import { deploymentHealth } from './base/deployment-health'
import { lobbyResponse } from './base/lobby'
import { setupStateResponse } from './base/setup-state'
import { authResponse, businessSettings, operatorAuth, runtimeBindings, type Bindings } from './auth.server'
import { identity } from './identity'
import { AGENT_PATHS, agentsPageRedirect, stumpAgentDoor, withProtocolHint } from './stump/agent-door/index.ts'
import { consentCallback } from './stump/accounts/callback.ts'
import { appDocumentGate } from './stump/http/app-gate.ts'
import { importDoorResponse } from './stump/imports/door.ts'
import { personDoorResponse } from './stump/http/routes.ts'
import { readCapped } from './stump/http/body.ts'
import { publishDue } from './stump/publish/tick.ts'
import { tickHandoffs } from './stump/handoffs/refresh.ts'
import { pollDueWatches } from './stump/watches/scheduled.ts'

const api = new Hono<{ Bindings: Bindings }>()
api.get('/health', (context) => context.json({ status: 'ok', ...deploymentHealth(context.env) }))

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (Cloudflare's email address obfuscation
// honours it; src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

// The agent door's own pages and policy routes (approvals, Pause, the policy) take
// bodies of a few fields; each is read to at most the MCP door's 1 MiB before the
// door sees it. POST /mcp keeps the door's own capped read.
const AGENT_BODY_BYTES = 1024 * 1024
async function agentDoorRequest(request: Request, path: string): Promise<Request | Response> {
  if (path === '/mcp' || ['GET', 'HEAD'].includes(request.method) || !request.body) return request
  const bytes = await readCapped(request, AGENT_BODY_BYTES)
  if (!bytes) return Response.json({ code: 'request_too_large', max_bytes: AGENT_BODY_BYTES }, { status: 413, headers: { 'cache-control': 'no-store' } })
  const headers = new Headers(request.headers); headers.delete('content-length')
  return new Request(request.url, { method: request.method, headers, body: bytes })
}

export default withDemo<Bindings, ExportedHandler<Bindings>>({
  // The scheduler tick: due items go out unless a Pause covers them (src/stump/publish/tick.ts).
  async scheduled(controller, env) {
    try { await publishDue(runtimeBindings(env), controller.scheduledTime) }
    finally {
      // Hand-offs never wait in silence: review dates, rule changes and lapses (src/stump/handoffs/lapse.ts).
      try { await tickHandoffs(runtimeBindings(env), controller.scheduledTime) }
      finally { await pollDueWatches(runtimeBindings(env), controller.scheduledTime) }
    }
  },
  async fetch(request, env, execution) {
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
    const path = new URL(request.url).pathname
    // The one MCP door and the Agents pages, before app sign-in redirects (Base modules/agent-door/ADOPTING.md).
    if (AGENT_PATHS(path)) {
      const moved = agentsPageRedirect(request)
      if (moved) return moved
      const bounded = await agentDoorRequest(request, path)
      if (bounded instanceof Response) return bounded
      const agent = await stumpAgentDoor(env).handle(bounded)
      if (agent) return rejectedResponse(bounded, path === '/mcp' ? await withProtocolHint(agent) : agent)
    }
    // The owner's import door: venue lists today (src/stump/imports/door.ts).
    const imported = await importDoorResponse(request, env)
    if (imported) return rejectedResponse(request, imported)
    if (['/api/rer/business-settings', '/rer-business-logo', '/rer-business.css'].includes(path)) {
      const settings = await businessSettings(runtimeBindings(env)).handle(request)
      if (settings) return rejectedResponse(request, settings)
    }
    const auth = await authResponse(request, env)
    if (auth) return auth
    const person = await personDoorResponse(request, env)
    if (person) return rejectedResponse(request, person)
    const gate = await appDocumentGate(request, env)
    if (gate) return gate
    // A network's consent screen returns here; the server finishes the connection (src/stump/accounts/callback.ts).
    const consent = await consentCallback(request, env)
    if (consent) return consent
    // The installed variant: the Lobby at / and the public claim state it reads.
    // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity, undefined, request => operatorAuth(runtimeBindings(env)).getSession(request))
    if (lobby) return lobby
    return rejectedResponse(request, await dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request))))
  },
} satisfies ExportedHandler<Bindings>)
