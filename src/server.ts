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
import { AGENT_PATHS, stumpAgentDoor } from './stump/agent-door/index.ts'
import { appDocumentGate } from './stump/http/app-gate.ts'
import { personDoorResponse } from './stump/http/routes.ts'
import { publishDue } from './stump/publish/tick.ts'
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

export default withDemo<Bindings, ExportedHandler<Bindings>>({
  // The scheduler tick: due items go out unless a Pause covers them (src/stump/publish/tick.ts).
  async scheduled(controller, env) {
    try { await publishDue(runtimeBindings(env), controller.scheduledTime) }
    finally { await pollDueWatches(runtimeBindings(env), controller.scheduledTime) }
  },
  async fetch(request, env, execution) {
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
    const path = new URL(request.url).pathname
    // The one MCP door and the Agents pages, before app sign-in redirects (Base modules/agent-door/ADOPTING.md).
    if (AGENT_PATHS(path)) {
      const agent = await stumpAgentDoor(env).handle(request)
      if (agent) return rejectedResponse(request, agent)
    }
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
    // The installed variant: the Lobby at / and the public claim state it reads.
    // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity, undefined, request => operatorAuth(runtimeBindings(env)).getSession(request))
    if (lobby) return lobby
    return rejectedResponse(request, await dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request))))
  },
} satisfies ExportedHandler<Bindings>)
