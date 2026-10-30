import { operatorAuth, runtimeBindings } from '../../auth.server'
import type { StumpEnv } from '../env.ts'
import { resolvePerson } from '../people/store.ts'

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex' }

/**
 * App documents under /app open only for a signed-in Stump person. Everyone
 * else signs in first; a signed-in account that is not on the team (no accepted
 * invitation) is told so.
 */
export async function appDocumentGate(request: Request, original: StumpEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== '/app' && !url.pathname.startsWith('/app/')) return null
  const env = runtimeBindings(original)
  const session = await operatorAuth(env).getSession(request)
  if (!session) return new Response(null, { status: 303, headers: { ...headers, location: `/signin?returnTo=${encodeURIComponent(url.pathname + url.search)}` } })
  if (await resolvePerson(env.DB, session.operator)) return null
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not on this team</title></head><body><main><h1>You are not on this team yet</h1><p>Ask an owner or admin of this Stump to invite this email address, then sign in again.</p><p><a href="/signin">Sign in with another email</a></p></main></body></html>',
    { status: 403, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
}
