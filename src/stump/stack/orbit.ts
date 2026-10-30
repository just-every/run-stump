// Orbit's signed signal door: POST <orbit>/api/v1/signals/<source_id> with
// X-Orbit-Timestamp (epoch seconds) and X-Orbit-Signature, the hex HMAC-SHA256 of
// "<timestamp>.<body>" under the source's secret. The event type of a source's own
// events is "<source_id>:<name>". Orbit decides whether the person is contactable.
export interface EngagerOffer {
  id: string
  network: string
  handle: string
  display_name: string | null
  post_url: string
  engagement: string | null
  public_email: string | null
  /** The network's own id for the person, when the network gives one. */
  network_user_id?: string | null
  occurred_at: number
}

export interface SignalEvent {
  eventId: string
  type: string
  subject: string
  occurredAt: string
  email?: string
  identityBasis: string
  data: Record<string, unknown>
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')

/**
 * The social-engagement signal for an engager. Only what is public goes: the handle,
 * the post link and, when the person shows one on their own profile, their email. The
 * identity basis is the same for the same person every time: the network's own id for
 * them where the network gives one (it outlives a handle change), else their handle.
 * The event id is the offer's, so a resend of one offer is a replay in Orbit and never
 * a second signal.
 */
export function engagerEvent(sourceId: string, offer: EngagerOffer): SignalEvent {
  const handle = offer.handle.trim(), network = offer.network.trim().toLowerCase()
  return {
    eventId: `stump-engager-${offer.id}`,
    type: `${sourceId}:social-engagement`,
    subject: `${offer.display_name ? `${offer.display_name} (${handle})` : handle} engaged on ${network}`.slice(0, 2000),
    occurredAt: new Date(offer.occurred_at).toISOString(),
    ...(offer.public_email ? { email: offer.public_email } : {}),
    identityBasis: offer.network_user_id ? `stump:engager:${network}:id:${offer.network_user_id}` : `stump:engager:${network}:${handle.toLowerCase()}`,
    data: { network, handle, post_url: offer.post_url, ...(offer.engagement ? { engagement: offer.engagement } : {}), ...(offer.display_name ? { display_name: offer.display_name } : {}) },
  }
}

export async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)))
}

export interface SendOutcome {
  ok: boolean
  status: number | null
  at: string
  detail: Record<string, unknown>
  error?: string
}

function failure(status: number | null, now: number, error: string, detail: Record<string, unknown> = {}): SendOutcome {
  return { ok: false, status, at: new Date(now).toISOString(), detail, error }
}

/** Sends one signed event and reads Orbit's answer: 201 is an accepted (or replayed) signal. */
export async function postSignal(fetcher: typeof fetch, connection: { origin: string; source_id: string; secret: string }, event: SignalEvent, now: number): Promise<SendOutcome> {
  const body = JSON.stringify(event), timestamp = String(Math.floor(now / 1000))
  let response: Response
  try {
    response = await fetcher(`${connection.origin}/api/v1/signals/${encodeURIComponent(connection.source_id)}`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json', 'x-orbit-timestamp': timestamp, 'x-orbit-signature': await sign(connection.secret, timestamp, body) }, body,
    })
  } catch (cause) {
    return failure(null, now, `Orbit could not be reached: ${cause instanceof Error ? cause.message : 'network error'}. Sending again is safe; Orbit treats a repeat as a replay.`)
  }
  const answer = await response.json().catch(() => ({})) as { id?: string; linked?: boolean; replayed?: boolean; error?: string }
  if (response.status === 201 || response.status === 200) {
    return { ok: true, status: response.status, at: new Date(now).toISOString(), detail: { orbit_signal_id: answer.id ?? null, linked: answer.linked ?? null, replayed: answer.replayed === true, event_id: event.eventId } }
  }
  return failure(response.status, now, answer.error ?? `Orbit answered ${response.status}.`, { event_id: event.eventId })
}
