// Vane's annotation door (DASH-009): POST <vane>/api/vane/annotations with the
// site's annotation secret as a bearer token and {siteId, id, kind, at, title, url}.
// A repeat of the same id is accepted as a duplicate, so a resend never doubles.
import type { SendOutcome } from './orbit.ts'

/** Vane's own list of hook kinds. */
export const VANE_KINDS = ['deploy', 'release', 'incident', 'error-spike', 'campaign', 'maintenance'] as const
export type VaneKind = typeof VANE_KINDS[number]

export interface Annotation { siteId: string; id: string; kind: VaneKind; at: number; title: string; url?: string }

export interface AnnotatedEntry { id: string; network: string | null; text: string | null; url: string | null; posted_at: number | null }

const NETWORKS: Record<string, string> = { bluesky: 'Bluesky', mastodon: 'Mastodon', x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit', hn: 'Hacker News', threads: 'Threads' }
const TITLE_MAX = 120

/** Plain text of at most 120 characters with no markup or control characters, as Vane requires. */
function title(entry: AnnotatedEntry): string {
  const where = entry.network ? NETWORKS[entry.network.toLowerCase()] ?? entry.network : 'Post'
  const words = (entry.text ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()
  const head = `${where}: `
  const room = TITLE_MAX - head.length
  const cut = words.length <= room ? words : `${Array.from(words.slice(0, room - 1)).join('').replace(/[\ud800-\udbff]$/, '').trimEnd()}…`
  return `${head}${cut}`.trim()
}

/** A published post is a campaign touch on its day, linked to the ledger entry by its id. */
export function annotationFor(siteId: string, entry: AnnotatedEntry): Annotation {
  return { siteId, id: `stump-ledger-${entry.id}`, kind: 'campaign', at: entry.posted_at ?? 0, title: title(entry), ...(entry.url ? { url: entry.url } : {}) }
}

export async function postAnnotation(fetcher: typeof fetch, connection: { origin: string; secret: string }, annotation: Annotation, now: number): Promise<SendOutcome> {
  let response: Response
  try {
    response = await fetcher(`${connection.origin}/api/vane/annotations`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${connection.secret}` },
      body: JSON.stringify(annotation),
    })
  } catch (cause) {
    return { ok: false, status: null, at: new Date(now).toISOString(), detail: {}, error: `Vane could not be reached: ${cause instanceof Error ? cause.message : 'network error'}. Sending again is safe; Vane treats a repeat as a duplicate.` }
  }
  const answer = await response.json().catch(() => ({})) as { accepted?: boolean; duplicate?: boolean; error?: string; message?: string }
  if (response.status === 201 || (response.status === 200 && answer.accepted)) {
    return { ok: true, status: response.status, at: new Date(now).toISOString(), detail: { annotation_id: annotation.id, duplicate: answer.duplicate === true } }
  }
  return { ok: false, status: response.status, at: new Date(now).toISOString(), detail: { annotation_id: annotation.id }, error: answer.message ?? answer.error ?? `Vane answered ${response.status}.` }
}
