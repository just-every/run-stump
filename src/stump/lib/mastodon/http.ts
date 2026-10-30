// One request through the injected fetch, with a timeout and classified failures.
// Request shapes: https://docs.joinmastodon.org/api/guidelines/ and the method pages cited by each caller.

import {
  classifyResponse,
  classifyThrown,
  fail,
  invalidResponse,
  ok,
  parseRateLimit,
  type RateLimitInfo,
  type Result,
} from './errors.ts';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpDeps {
  fetch: FetchFn;
  /** Milliseconds to wait for an answer. Default 20000. */
  timeoutMs?: number;
  now?: () => number;
}

export interface RawRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string | FormData | URLSearchParams;
  /** Changes state on the network: a lost answer is an unknown outcome. */
  write: boolean;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  json: unknown;
}

export const DEFAULT_TIMEOUT_MS = 20_000;

export async function send(deps: HttpDeps, req: RawRequest): Promise<Result<RawResponse>> {
  const now = deps.now ?? Date.now;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // The timeout must end the wait even when the injected fetch ignores its abort signal.
  const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
  aborted.catch(() => {});
  let res: Response;
  let text: string;
  try {
    const init: RequestInit = { method: req.method, headers: req.headers ?? {}, signal: controller.signal, redirect: 'follow' };
    if (req.body !== undefined) init.body = req.body;
    res = await Promise.race([deps.fetch(req.url, init), aborted]);
    text = await Promise.race([res.text(), aborted]);
  } catch (err) {
    return fail(classifyThrown(err, req.write));
  } finally {
    clearTimeout(timer);
  }
  let json: unknown = undefined;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (res.status < 200 || res.status >= 300) {
    return fail(classifyResponse({ status: res.status, headers: res.headers, body: json ?? text, write: req.write, nowMs: now() }));
  }
  const rate: RateLimitInfo | undefined = parseRateLimit(res.headers);
  if (json === undefined) {
    // A 2xx whose body cannot be read: for a write that is an unknown outcome, not a success.
    if (req.write) {
      return fail({ kind: 'unknown_outcome', code: 'unreadable_answer', status: res.status, message: 'The network answered with a body that is not JSON', outcomeUnknown: true });
    }
    return invalidResponse('The network answered with a body that is not JSON', res.status);
  }
  return ok({ status: res.status, headers: res.headers, json }, rate);
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function formBody(fields: Array<[string, string]>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of fields) p.append(k, v);
  return p;
}
