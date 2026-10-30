/**
 * One outbound call to LinkedIn through the injected fetch: bearer auth, the
 * LinkedIn-Version and Rest.li headers, a timeout, and every failure sorted by
 * errors.ts. Nothing here retries.
 */
import { classifyLinkedInResponse, classifyLinkedInThrown, type LinkedInRequestInfo } from './errors'
import type { LinkedInContext, LinkedInError, LinkedInOutcome } from './types'

export const LINKEDIN_API_BASE = 'https://api.linkedin.com'
/** The LinkedIn-Version header value (YYYYMM). Posts API docs list versions through 202610. */
export const LINKEDIN_API_VERSION = '202610'

export interface LinkedInCall<T> extends LinkedInRequestInfo {
  path: string
  query?: Record<string, string | number | undefined>
  json?: unknown
  /** Skip LinkedIn-Version and Rest.li headers (the OpenID userinfo endpoint is outside /rest). */
  plain?: boolean
  headers?: Record<string, string>
  okStatuses?: number[]
  parse: (body: any, status: number, headers: Headers) => T | LinkedInError
}

function isLinkedInError(v: unknown): v is LinkedInError {
  return !!v && typeof v === 'object' && 'kind' in v && 'retry' in v && 'mayHaveApplied' in v
}

/** Runs a fetch with a timeout, returning the answer and its text or a failure. */
export async function timedFetch(
  fetchFn: LinkedInContext['fetch'],
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: true; res: Response; text: string } | { ok: false; err: unknown; timedOut: boolean }> {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('timeout'))
    }, timeoutMs)
  })
  try {
    const exchange = (async () => {
      const res = await fetchFn(url, { ...init, signal: controller.signal })
      return { res, text: await res.text() }
    })()
    exchange.catch(() => {})
    const got = await Promise.race([exchange, timeout])
    return { ok: true, ...got }
  } catch (err) {
    return { ok: false, err, timedOut }
  } finally {
    clearTimeout(timer)
  }
}

export function parseJson(text: string): unknown {
  if (text.trim() === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function linkedInCall<T>(ctx: LinkedInContext, call: LinkedInCall<T>): Promise<LinkedInOutcome<T>> {
  const base = (ctx.baseUrl ?? LINKEDIN_API_BASE).replace(/\/+$/, '')
  // Query strings are built by hand: Rest.li wants encoded URNs and literal parentheses.
  const qs = Object.entries(call.query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  const url = base + call.path + (qs ? `?${qs}` : '')

  const headers: Record<string, string> = { authorization: `Bearer ${ctx.accessToken}`, accept: 'application/json' }
  if (!call.plain) {
    headers['linkedin-version'] = ctx.apiVersion ?? LINKEDIN_API_VERSION
    headers['x-restli-protocol-version'] = '2.0.0'
  }
  let body: string | undefined
  if (call.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(call.json)
  }
  Object.assign(headers, call.headers)

  const got = await timedFetch(ctx.fetch, url, { method: call.method, headers, body }, ctx.timeoutMs ?? 30_000)
  if (!got.ok) return { ok: false, error: classifyLinkedInThrown(got.err, call, got.timedOut) }
  const json = parseJson(got.text)
  if (!(call.okStatuses ?? [200, 201, 204]).includes(got.res.status)) {
    return { ok: false, error: classifyLinkedInResponse(got.res.status, got.res.headers, json, got.text, call) }
  }
  const parsed = call.parse(json, got.res.status, got.res.headers)
  if (isLinkedInError(parsed)) return { ok: false, error: parsed }
  return { ok: true, value: parsed, status: got.res.status }
}
