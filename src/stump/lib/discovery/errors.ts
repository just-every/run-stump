import type { SourceErrorKind, SourceKind } from './types.ts'

/**
 * A failed poll. The spine stores `describeError(e)` on the watch with its time (STUMP-WATCH-001.5,
 * STUMP-WATCH-002.3, STUMP-WATCH-003.5) and keeps earlier findings.
 */
export class SourceError extends Error {
  kind: SourceErrorKind
  source: SourceKind | 'alert'
  status?: number
  /** Milliseconds since epoch when the source says polling may resume (rate limits). */
  retry_at?: number
  /** Machine code for refusals, e.g. `reddit_not_a_source`. */
  code?: string

  constructor(
    kind: SourceErrorKind,
    source: SourceKind | 'alert',
    message: string,
    extra: { status?: number; retry_at?: number; code?: string } = {},
  ) {
    super(message)
    this.name = 'SourceError'
    this.kind = kind
    this.source = source
    this.status = extra.status
    this.retry_at = extra.retry_at
    this.code = extra.code
  }
}

export interface ErrorDescription {
  kind: SourceErrorKind | 'unexpected'
  message: string
  status?: number
  retry_at?: number
  code?: string
}

/** A shape safe to store and show: no stack, no request headers. */
export function describeError(e: unknown): ErrorDescription {
  if (e instanceof SourceError) {
    return { kind: e.kind, message: e.message, status: e.status, retry_at: e.retry_at, code: e.code }
  }
  return { kind: 'unexpected', message: e instanceof Error ? e.message : String(e) }
}
