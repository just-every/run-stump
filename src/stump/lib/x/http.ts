/**
 * One outbound call to X through the injected fetch: bearer auth, a timeout,
 * JSON in and out, and every failure sorted by errors.ts. Nothing here retries.
 */
import { classifyXResponse, classifyXThrown, parseRateLimit, type XRequestInfo } from './errors'
import type { XContext, XError, XResult } from './types'

export const X_API_BASE = 'https://api.x.com'

export interface XCall<T> extends XRequestInfo {
  path: string
  query?: Record<string, string | number | undefined>
  json?: unknown
  form?: FormData
  /** Turns the parsed JSON body into the value; return an XError to fail the call. */
  parse: (body: any, status: number) => T | XError
  /** Statuses treated as success; defaults to 200, 201 and 204. */
  okStatuses?: number[]
  headers?: Record<string, string>
}

function isXError(v: unknown): v is XError {
  return !!v && typeof v === 'object' && 'kind' in v && 'retry' in v && 'mayHaveApplied' in v
}

/** `post.fields` or `tweet.fields`, by the context's setting. */
export function fieldsParam(ctx: XContext, kind: 'post' | 'user' | 'media' | 'poll'): string {
  if (kind === 'post') return ctx.fieldsStyle === 'tweet' ? 'tweet.fields' : 'post.fields'
  return `${kind}.fields`
}

export async function xCall<T>(ctx: XContext, call: XCall<T>): Promise<XResult<T>> {
  const base = (ctx.baseUrl ?? X_API_BASE).replace(/\/+$/, '')
  const url = new URL(base + call.path)
  for (const [k, v] of Object.entries(call.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))

  const headers: Record<string, string> = { authorization: `Bearer ${ctx.accessToken}`, accept: 'application/json', ...call.headers }
  let body: BodyInit | undefined
  if (call.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(call.json)
  } else if (call.form) {
    body = call.form
  }

  const controller = new AbortController()
  const timeoutMs = ctx.timeoutMs ?? 30_000
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('timeout'))
    }, timeoutMs)
  })

  let res: Response
  let text: string
  try {
    const exchange = (async () => {
      const r = await ctx.fetch(url.toString(), { method: call.method, headers, body, signal: controller.signal })
      return { r, t: await r.text() }
    })()
    exchange.catch(() => {})
    const got = await Promise.race([exchange, timeout])
    res = got.r
    text = got.t
  } catch (err) {
    return { ok: false, error: classifyXThrown(err, call, timedOut) }
  } finally {
    clearTimeout(timer)
  }

  let json: unknown = null
  if (text.trim() !== '') {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }
  const okStatuses = call.okStatuses ?? [200, 201, 204]
  if (!okStatuses.includes(res.status)) {
    return { ok: false, error: classifyXResponse(res.status, res.headers, json, text, call) }
  }
  const parsed = call.parse(json, res.status)
  if (isXError(parsed)) return { ok: false, error: parsed }
  return { ok: true, value: parsed, status: res.status, rateLimit: parseRateLimit(res.headers) }
}

/** Reads a 200 body whose `errors` array reports the resource itself as missing or hidden. */
export function resourceError(body: any, status: number): XError | null {
  if (body && typeof body === 'object' && body.data === undefined && Array.isArray(body.errors) && body.errors.length > 0) {
    const e = body.errors[0] ?? {}
    const type = typeof e.type === 'string' ? e.type : null
    const detail = String(e.detail ?? e.message ?? e.title ?? 'X returned no data for this resource.')
    const notFound = /resource-not-found/.test(type ?? '') || /not found/i.test(String(e.title ?? ''))
    return {
      kind: notFound ? 'not_found' : 'forbidden',
      status,
      message: detail,
      type,
      code: null,
      resetAt: null,
      retry: 'never',
      mayHaveApplied: false,
    }
  }
  return null
}
