// One request through the injected fetch, with a timeout and classified failures.

import { classifyResponse, classifyThrown, fail, invalidResponse, ok, parseRateLimit, type NetworkError, type Result } from './errors.ts';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpDeps {
  fetch: FetchFn;
  /** Milliseconds to wait for an answer. Default 20000. */
  timeoutMs?: number;
  now?: () => number;
}

export interface RawRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | URLSearchParams;
  /** Changes state on the network: a lost answer is an unknown outcome. */
  write: boolean;
  /** Treat an empty 2xx body as success (some procedures return none). */
  allowEmpty?: boolean;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  json: unknown;
}

export type RawOutcome = { thrown: NetworkError } | { thrown?: undefined; status: number; headers: Headers; json: unknown; text: string };

export const DEFAULT_TIMEOUT_MS = 20_000;

/** Sends and reads the answer without judging it. */
export async function sendRaw(deps: HttpDeps, req: RawRequest): Promise<RawOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // The timeout must end the wait even when the injected fetch ignores its abort signal.
  const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
  aborted.catch(() => {});
  try {
    // Every atproto service answers at its own address, so a redirect is never followed: it is answered as a refusal.
    const init: RequestInit = { method: req.method, headers: req.headers ?? {}, signal: controller.signal, redirect: 'manual' };
    if (req.body !== undefined) init.body = req.body as BodyInit;
    const res = await Promise.race([deps.fetch(req.url, init), aborted]);
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      return { thrown: { kind: 'invalid_response', code: 'redirected', status: res.status, message: 'The server answered with a redirect to another address. Stump sends Bluesky requests only to the address the account\'s record names.', outcomeUnknown: false } };
    }
    const text = await Promise.race([res.text(), aborted]);
    let json: unknown = undefined;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    return { status: res.status, headers: res.headers, json, text };
  } catch (err) {
    return { thrown: classifyThrown(err, req.write) };
  } finally {
    clearTimeout(timer);
  }
}

/** Turns a raw answer into a Result: 2xx with a JSON body is ok, everything else is a classified error. */
export function judge(deps: HttpDeps, req: RawRequest, raw: RawOutcome): Result<RawResponse> {
  if (raw.thrown) return fail(raw.thrown);
  const now = (deps.now ?? Date.now)();
  if (raw.status < 200 || raw.status >= 300) {
    return fail(classifyResponse({ status: raw.status, headers: raw.headers, body: raw.json ?? raw.text, write: req.write, nowMs: now }));
  }
  const rate = parseRateLimit(raw.headers, now);
  if (raw.json === undefined) {
    if (req.allowEmpty && raw.text.length === 0) return ok({ status: raw.status, headers: raw.headers, json: {} }, rate);
    if (req.write) {
      return fail({ kind: 'unknown_outcome', code: 'unreadable_answer', status: raw.status, message: 'The network answered with a body that is not JSON', outcomeUnknown: true });
    }
    return invalidResponse('The network answered with a body that is not JSON', raw.status);
  }
  return ok({ status: raw.status, headers: raw.headers, json: raw.json }, rate);
}

export async function send(deps: HttpDeps, req: RawRequest): Promise<Result<RawResponse>> {
  return judge(deps, req, await sendRaw(deps, req));
}
