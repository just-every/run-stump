// The browser side of the import door: Base's 64 KiB chunk upload, the saved
// dry run, the reviewed apply and Undo, at /api/operator/import/*?source=<id>.
export type ImportSourceId = 'outreach-md' | 'venues-csv'
const CHUNK = 65_536

export class ImportError extends Error {
  constructor(readonly code: string, readonly details: Record<string, unknown> = {}) { super(code); this.name = 'ImportError' }
}

async function post<T>(action: string, source: ImportSourceId, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/operator/import/${action}?source=${source}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
  const answer = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new ImportError(typeof answer.error === 'string' ? answer.error : 'import_failed', (answer.details ?? {}) as Record<string, unknown>)
  return answer as T
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const sha256 = async (bytes: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
function base64(bytes: Uint8Array) {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

export interface Plan {
  planId: string; fingerprint: string; created: boolean
  summary: { sourceRecords: number; created: number; updated: number; unchanged: number; gone: number; venues?: number; entries?: number; excluded?: number }
  rejected: Array<{ kind: string; sourceId: string; reason: string }>
  differences: { additions: string[]; replacements: string[]; unchanged: string[]; gone: string[]; conflicts: string[] }
}
export interface Job { id: string; state: string; checkpoint?: number; total?: number }
export interface Kept { kind: string; id: string; name: string | null; reason: 'edited' | 'in_use' }

/** Uploads the file in 64 KiB chunks and saves its dry run. Nothing is written to the register. */
export async function planFile(source: ImportSourceId, file: File): Promise<Plan> {
  const bytes = new Uint8Array(await file.arrayBuffer()), totalChunks = Math.max(1, Math.ceil(bytes.length / CHUNK))
  const name = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'venue-list'
  const meta = { name, bundleSha256: await sha256(bytes), totalBytes: bytes.length, totalChunks }
  let uploadId: string | undefined
  for (let index = 0; index < totalChunks; index++) {
    const chunk = bytes.subarray(index * CHUNK, (index + 1) * CHUNK)
    const answer = await post<{ uploadId: string }>('uploads', source, { ...(uploadId ? { uploadId } : {}), ...meta, index, chunkSha256: await sha256(chunk), base64: base64(chunk) })
    uploadId = answer.uploadId
  }
  return post<Plan>('plan', source, { uploadId })
}

/** Applies the reviewed plan in bounded batches until the import completes. */
export async function applyPlan(source: ImportSourceId, plan: Plan): Promise<Job> {
  for (let round = 0; round < 200; round++) {
    const { job } = await post<{ job: Job }>('apply', source, { planId: plan.planId, reviewedFingerprint: plan.fingerprint })
    if (job.state === 'completed') return job
    if (!['queued', 'applying', 'running', 'pending'].includes(job.state)) throw new ImportError(`import_${job.state}`)
  }
  throw new ImportError('import_incomplete')
}

export const undoPlan = (source: ImportSourceId, planId: string) => post<{ job: Job; kept: Kept[] }>('undo', source, { planId })
