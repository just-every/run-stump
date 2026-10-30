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
import { REJECTED_KIND } from '../lib/imports/index.ts'
import { resolvePerson } from '../people/store.ts'
import { rowChanges, type PlanRow } from '../venues/import/changes.ts'
import { keptAfterUndo, releaseKept } from '../venues/import/kept.ts'
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
  /** The rows the reader refused, with their reasons, when it read this upload. */
  rejected(): Array<{ kind: string; sourceId: string; reason: string }> | null
  /** Each replaced or conflicting row of a plan, with the fields it changes before and after. */
  changes(rows: PlanRow[]): Promise<unknown[]>
  /** Rows the file names that are already the seed's own records, kept as they are. */
  existing(): unknown[]
}
type SourceFactory = (db: D1Database, ownerId: string) => Promise<ImportSource>

const venueList = (namespace: 'outreach-md' | 'venues-csv'): SourceFactory => async (db, ownerId) => {
  const { source, summary, rejected, mapped, existing } = await venueListSource(db, namespace, ownerId)
  return {
    destination: VENUE_DESTINATION, targets: venueListTargets, source, rejected, existing,
    summary: () => summary() as unknown as Record<string, number> | null,
    changes: rows => rowChanges(db, rows, mapped),
  }
}

/** The server-owned allow-list of import sources. */
const SOURCES: Record<string, SourceFactory> = {
  'outreach-md': venueList('outreach-md'),
  'venues-csv': venueList('venues-csv'),
}

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const refused = (error: string, status: number, details?: Record<string, unknown>) => Response.json({ error, ...(details ? { details } : {}) }, { status, headers })
const parsed = (text: string | null): Record<string, unknown> | null => { try { const value = text ? JSON.parse(text) as unknown : null; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null } catch { return null } }
interface Preview { planId: string; fingerprint: string; bundleSha256: string; created: boolean; summary: Record<string, number>; rejected: Array<{ kind: string; sourceId: string; reason: string }>; differences: Record<'additions' | 'replacements' | 'unchanged' | 'gone' | 'conflicts', string[]> }

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
  // The kit takes no query string: the source chose the namespace above, and each call goes on without it.
  const action = url.pathname.slice(PREFIX.length), body = request.method === 'POST' ? await request.text() : null, input = parsed(body)
  const kit = (verb: string, text: string | null) => {
    const copied = new Headers(request.headers); copied.delete('content-length')
    return handler(new Request(new URL(PREFIX + verb, url.origin), { method: request.method, headers: copied, body: text })) as Promise<Response>
  }
  const lineage = () => env.DB.prepare('SELECT head_id,pending_id FROM ik_door_namespaces WHERE installation_id=? AND namespace=?').bind(IMPORT_DOOR_KEY, name)
    .first<{ head_id: string | null; pending_id: string | null }>().then(row => row ?? { head_id: null, pending_id: null })
  const errorOf = async (response: Response) => response.status >= 400 ? (await response.clone().json() as { error?: string }).error ?? null : null

  if (action === 'plan' && input) return planned(input)
  if (action === 'status' && request.method === 'POST' && input && input.planId === undefined && Object.keys(input).length === 0) return waiting()
  if (action === 'undo' && input && typeof input.planId === 'string') {
    // An applied import under a later one cannot be undone on its own: the later one names its records.
    const checked = await kit('status', JSON.stringify({ planId: input.planId }))
    if (checked.ok) {
      const row = await env.DB.prepare('SELECT j.state FROM ik_door_plans p JOIN ik_jobs j ON j.id=p.job_id WHERE p.id=? AND p.installation_id=? AND p.namespace=?')
        .bind(input.planId, IMPORT_DOOR_KEY, name).first<{ state: string }>()
      const { head_id } = await lineage()
      if (row?.state === 'completed' && head_id && head_id !== input.planId) return refused('import_superseded', 409, { planId: head_id, reason: 'A newer import of this list is applied over this one. Undo the newer import first.' })
    }
  }
  const response = await kit(action, body)
  if (!response.ok || action !== 'undo') return response
  // Undo keeps what was edited since, and what something else now uses; it says which.
  const result = await response.json() as Record<string, unknown>, job = result.job as { id?: string; state?: string } | undefined
  const kept = job?.id ? await keptAfterUndo(env.DB, job.id) : []
  // A finished Undo hands what it kept back to Stump: a later import of the list meets it as already in the register.
  if (job?.state === 'undone') await releaseKept(env.DB, kept)
  result.kept = kept
  return Response.json(result, { status: response.status, headers })

  /** A source's waiting and applied imports, so a review closed without a choice can be found again. */
  async function waiting(): Promise<Response> {
    if (url.origin !== env.AUTH_ORIGIN || request.headers.get('Origin') !== env.AUTH_ORIGIN) return refused('origin_required', 403)
    const read = async (id: string | null) => id ? await (await kit('status', JSON.stringify({ planId: id }))).json() : null
    const pending = await read((await lineage()).pending_id), head = await read((await lineage()).head_id)
    return Response.json({ source: name, pending, head }, { headers })
  }

  /** Cancels the source's plan that was reviewed and never applied: a new upload takes its place. */
  async function cancelUnapplied() {
    const { pending_id } = await lineage()
    if (!pending_id) return
    const started = await env.DB.prepare(`SELECT 1 FROM ik_door_plans p WHERE p.id=? AND (p.job_id IS NOT NULL OR EXISTS(SELECT 1 FROM ik_jobs j WHERE j.operation_key='door:'||p.id))`).bind(pending_id).first()
    if (!started) await kit('undo', JSON.stringify({ planId: pending_id }))
  }

  /**
   * Once a source has an applied import, a new file is planned against it (a
   * catch-up): a changed row replaces only what nobody edited here, and an
   * edited one is named as a conflict. A file that changes nothing is the
   * applied import itself: its plan is that import, so applying it again is a
   * no-op and Undo stays in line.
   */
  async function planned(given: Record<string, unknown>): Promise<Response> {
    await cancelUnapplied()
    const { head_id } = await lineage()
    let response: Response, catchup = false
    if (given.catchup === undefined && head_id) {
      response = await kit('plan', JSON.stringify({ ...given, catchup: true })); catchup = true
      if (await errorOf(response) === 'catchup_requires_baseline') { response = await kit('plan', body); catchup = false }
    } else response = await kit('plan', body)
    if (!response.ok) return response
    const result = await response.json() as Preview & Record<string, unknown>, d = result.differences
    const counted = entry.summary(), bundle = result.bundleSha256
    if (counted) await env.DB.prepare('INSERT INTO stump_import_summaries(namespace,bundle_sha256,summary) VALUES(?,?,?) ON CONFLICT DO UPDATE SET summary=excluded.summary').bind(name, bundle, JSON.stringify(counted)).run()
    const stored = counted ?? JSON.parse((await env.DB.prepare('SELECT summary FROM stump_import_summaries WHERE namespace=? AND bundle_sha256=?').bind(name, bundle).first<{ summary: string }>())?.summary ?? '{}')
    result.summary = { ...result.summary, ...stored }
    // Refused rows are the file's own; a changed row the import will not take is a conflict, listed with the changes.
    const keyed = (key: string) => { const [kind, sourceId] = JSON.parse(key) as [string, string]; return { kind, sourceId } }
    const reasons = new Map(result.rejected.map(row => [`${row.kind}|${row.sourceId}`, row.reason]))
    result.rejected = entry.rejected() ?? result.rejected.filter(row => row.kind === REJECTED_KIND)
    const rows: PlanRow[] = [...d.replacements.map(key => ({ ...keyed(key), conflict: false })), ...d.conflicts.map(key => ({ ...keyed(key), conflict: true }))]
      .filter(row => row.kind !== REJECTED_KIND).map(row => ({ ...row, reason: reasons.get(`${row.kind}|${row.sourceId}`) ?? null }))
    result.changes = await entry.changes(rows)
    result.existing = entry.existing()
    const nothing = !d.additions.length && !d.replacements.length && !rows.some(row => row.conflict)
    if (catchup && nothing) {
      // Nothing to write: drop this catch-up and answer the applied import's own plan.
      await kit('undo', JSON.stringify({ planId: result.planId }))
      const current = (await lineage()).head_id
      const head = current ? await env.DB.prepare('SELECT id,fingerprint FROM ik_door_plans WHERE id=?').bind(current).first<{ id: string; fingerprint: string }>() : null
      if (head) Object.assign(result, { planId: head.id, fingerprint: head.fingerprint, created: false, applied: true })
    }
    return Response.json(result, { status: response.status, headers })
  }
}
