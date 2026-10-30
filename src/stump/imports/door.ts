// The one import door: Base import-kit's owner-session mount at
// POST /api/operator/import/{uploads,plan,apply,status,reconcile,undo}?source=<id>,
// with its 64 KiB chunk protocol, exact Origin and the signed-in owner. Each
// source is its own namespace; the allow-list below is the only place a source
// is added (one line each).
import { createImportOperatorHandler } from '../../modules/import-kit/src/door/operator.ts'
import type { D1Sql, D1TargetAdapter } from '../../modules/import-kit/src/d1/index.ts'
import type { ImportDoorRawSource } from '../../modules/import-kit/src/door/types.ts'
import { operatorAuth, runtimeBindings } from '../../auth.server'
import type { StumpEnv } from '../env.ts'
import { resolvePerson } from '../people/store.ts'
import { keptAfterUndo } from '../venues/import/kept.ts'
import { VENUE_DESTINATION, venueListSource } from '../venues/import/source.ts'
import { venueListTargets } from '../venues/import/targets.ts'

/** The permanent door key for settings, lineage and history. Never change it. */
export const IMPORT_DOOR_KEY = 'stump'
const PREFIX = '/api/operator/import/'

interface ImportSource {
  destination: string
  targets: D1TargetAdapter
  source: ImportDoorRawSource
  /** Counts the reader made of this upload, shown in the plan's summary. */
  summary(): Record<string, number> | null
}
type SourceFactory = (db: D1Database, ownerId: string) => Promise<ImportSource>

const venueList = (namespace: 'outreach-md' | 'venues-csv'): SourceFactory => async (db, ownerId) =>
{
  const { source, summary } = await venueListSource(db, namespace, ownerId)
  return { destination: VENUE_DESTINATION, targets: venueListTargets, source, summary: () => summary() as unknown as Record<string, number> | null }
}

/** The server-owned allow-list of import sources. */
const SOURCES: Record<string, SourceFactory> = {
  'outreach-md': venueList('outreach-md'),
  'venues-csv': venueList('venues-csv'),
}

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const refused = (error: string, status: number) => Response.json({ error }, { status, headers })

/** The signed-in owner's current session, checked again inside every import batch. */
const ownerSession = (sessionId: string): D1Sql => ({
  sql: `EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id JOIN stump_people p ON p.id=o.id
    WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND o.status='active' AND s.operator_version=o.version AND p.role='owner' AND p.status='active')`,
  params: [sessionId],
})

export async function importDoorResponse(request: Request, original: StumpEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(PREFIX)) return null
  const env = runtimeBindings(original)
  const name = url.searchParams.get('source') ?? request.headers.get('x-import-source') ?? ''
  if (!Object.hasOwn(SOURCES, name)) return refused('unknown_import_source', 400)
  const session = await operatorAuth(env).getSession(request) as { id: string; operator: { id: string; email: string; displayName?: string; role: string; status: string } } | null
  const person = session ? await resolvePerson(env.DB, session.operator) : null
  if (!session || !person) return refused('owner_required', 401)
  if (person.role !== 'owner') return refused('owner_required', 403)
  const entry = await SOURCES[name]!(env.DB, person.id)
  const handler = createImportOperatorHandler({
    database: env.DB as never, targets: entry.targets, destination: entry.destination, ownerPrincipalId: 'role:owner',
    limits: { maxBytes: 8_388_608, maxRecords: 100_000 }, ...entry.source,
    installationId: IMPORT_DOOR_KEY, appOrigin: env.AUTH_ORIGIN, ownerEmail: person.email, namespace: name,
    authorize: async () => ownerSession(session.id),
  })
  // The kit takes no query string: the source chose the namespace above, and the request goes on without it.
  const action = url.pathname.slice(PREFIX.length), body = request.method === 'POST' ? await request.text() : null
  const forward = (text: string | null) => {
    const copied = new Headers(request.headers); copied.delete('content-length')
    return new Request(new URL(url.pathname, url.origin), { method: request.method, headers: copied, body: text })
  }
  let response: Response
  const input = action === 'plan' && body ? JSON.parse(body) as Record<string, unknown> : null
  const head = input && input.catchup === undefined
    ? await env.DB.prepare('SELECT head_id FROM ik_door_namespaces WHERE installation_id=? AND namespace=? AND head_id IS NOT NULL').bind(IMPORT_DOOR_KEY, name).first()
    : null
  if (input && head) {
    // Once a source has an applied import, a new file is planned against it (a catch-up): the same file changes nothing,
    // a changed row replaces only what nobody edited here, and an edited one is named as a conflict.
    response = (await handler(forward(JSON.stringify({ ...input, catchup: true }))))!
    const refusal = response.status === 409 ? await response.clone().json() as { error?: string } : null
    if (refusal?.error === 'catchup_requires_baseline') response = (await handler(forward(body)))!
  } else response = (await handler(forward(body)))!
  if (!response.ok || !['plan', 'undo'].includes(action)) return response
  const result = await response.json() as Record<string, unknown>
  if (action === 'plan') {
    const bundle = String(result.bundleSha256), counted = entry.summary()
    if (counted) await env.DB.prepare('INSERT INTO stump_import_summaries(namespace,bundle_sha256,summary) VALUES(?,?,?) ON CONFLICT DO UPDATE SET summary=excluded.summary').bind(name, bundle, JSON.stringify(counted)).run()
    const stored = counted ?? JSON.parse((await env.DB.prepare('SELECT summary FROM stump_import_summaries WHERE namespace=? AND bundle_sha256=?').bind(name, bundle).first<{ summary: string }>())?.summary ?? '{}')
    result.summary = { ...result.summary as object, ...stored }
  } else {
    // Undo keeps what was edited since, and what something else now uses; it says which.
    const job = result.job as { id?: string } | undefined
    result.kept = job?.id ? await keptAfterUndo(env.DB, job.id) : []
  }
  return Response.json(result, { status: response.status, headers })
}
