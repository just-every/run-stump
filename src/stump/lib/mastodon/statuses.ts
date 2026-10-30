// Post, read back, delete and find statuses.
//
// Sources: https://docs.joinmastodon.org/methods/statuses/
//   POST /api/v1/statuses: status, media_ids[], poll[options][], poll[expires_in], poll[multiple],
//     poll[hide_totals], in_reply_to_id, sensitive, spoiler_text, visibility, language;
//     Idempotency-Key header (kept for up to one hour).
//   GET /api/v1/statuses/:id, GET /api/v1/statuses/:id/source (exact text, 3.5+),
//   DELETE /api/v1/statuses/:id (delete_media).
//   GET /api/v1/accounts/:id/statuses: https://docs.joinmastodon.org/methods/accounts/
//   Poll entity: https://docs.joinmastodon.org/entities/Poll/

import { fail, invalidResponse, ok, type Result } from './errors.ts';
import { bearer, formBody, send, type HttpDeps } from './http.ts';
import { htmlToText } from './text.ts';
import type { PostedPoll, PostedStatus, StatusDraft, StatusReadBack } from './types.ts';

export function parsePoll(v: unknown): PostedPoll | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== 'string' || !Array.isArray(p.options)) return null;
  return {
    id: p.id,
    expiresAt: typeof p.expires_at === 'string' ? p.expires_at : null,
    expired: p.expired === true,
    multiple: p.multiple === true,
    options: (p.options as unknown[]).map((o) => {
      const oo = (o ?? {}) as Record<string, unknown>;
      return { title: typeof oo.title === 'string' ? oo.title : '', votesCount: typeof oo.votes_count === 'number' ? oo.votes_count : null };
    }),
  };
}

export function parseStatus(json: unknown): PostedStatus | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  if (typeof j.id !== 'string' || typeof j.uri !== 'string' || typeof j.created_at !== 'string') return null;
  const account = j.account && typeof j.account === 'object' ? (j.account as Record<string, unknown>) : null;
  const media = Array.isArray(j.media_attachments) ? (j.media_attachments as unknown[]) : [];
  return {
    id: j.id,
    uri: j.uri,
    url: typeof j.url === 'string' && j.url !== '' ? j.url : j.uri,
    createdAt: j.created_at,
    visibility: typeof j.visibility === 'string' ? j.visibility : 'public',
    spoilerText: typeof j.spoiler_text === 'string' ? j.spoiler_text : '',
    sensitive: j.sensitive === true,
    inReplyToId: typeof j.in_reply_to_id === 'string' ? j.in_reply_to_id : null,
    language: typeof j.language === 'string' ? j.language : null,
    contentHtml: typeof j.content === 'string' ? j.content : '',
    media: media.map((m) => {
      const mm = (m ?? {}) as Record<string, unknown>;
      return {
        id: String(mm.id ?? ''),
        type: typeof mm.type === 'string' ? mm.type : 'unknown',
        url: typeof mm.url === 'string' ? mm.url : null,
        description: typeof mm.description === 'string' ? mm.description : null,
      };
    }),
    poll: parsePoll(j.poll),
    accountId: typeof account?.id === 'string' ? account.id : null,
  };
}

export async function postStatus(
  deps: HttpDeps,
  origin: string,
  token: string,
  draft: StatusDraft,
  idempotencyKey: string,
): Promise<Result<PostedStatus>> {
  if (idempotencyKey.trim() === '') throw new TypeError('postStatus needs an idempotency key');
  const fields: Array<[string, string]> = [['status', draft.text]];
  if (draft.spoilerText) fields.push(['spoiler_text', draft.spoilerText]);
  if (draft.visibility) fields.push(['visibility', draft.visibility]);
  if (draft.sensitive !== undefined) fields.push(['sensitive', String(draft.sensitive)]);
  if (draft.language) fields.push(['language', draft.language]);
  if (draft.inReplyToId) fields.push(['in_reply_to_id', draft.inReplyToId]);
  for (const id of draft.mediaIds ?? []) fields.push(['media_ids[]', id]);
  if (draft.poll) {
    for (const o of draft.poll.options) fields.push(['poll[options][]', o]);
    fields.push(['poll[expires_in]', String(draft.poll.expiresInSeconds)]);
    if (draft.poll.multiple !== undefined) fields.push(['poll[multiple]', String(draft.poll.multiple)]);
    if (draft.poll.hideTotals !== undefined) fields.push(['poll[hide_totals]', String(draft.poll.hideTotals)]);
  }
  const res = await send(deps, {
    method: 'POST',
    url: `${origin}/api/v1/statuses`,
    headers: { ...bearer(token), 'idempotency-key': idempotencyKey, accept: 'application/json' },
    body: formBody(fields),
    write: true,
  });
  if (!res.ok) return fail(res.error);
  const status = parseStatus(res.value.json);
  if (!status) {
    // 2xx without a status (for example a scheduled status) is not a posted status.
    return fail({ kind: 'invalid_response', code: 'not_a_status', status: res.value.status, message: 'The instance answered 2xx without a status', outcomeUnknown: true });
  }
  return ok(status, res.rate);
}

export async function getStatus(deps: HttpDeps, origin: string, token: string | null, id: string): Promise<Result<PostedStatus>> {
  const res = await send(deps, { method: 'GET', url: `${origin}/api/v1/statuses/${encodeURIComponent(id)}`, headers: { ...(token ? bearer(token) : {}), accept: 'application/json' }, write: false });
  if (!res.ok) return fail(res.error);
  const status = parseStatus(res.value.json);
  if (!status) return invalidResponse('Status answer is missing id, uri or created_at', res.value.status);
  return ok(status, res.rate);
}

/** Exact posted text and content warning, as typed. Needs read:statuses. */
export async function getStatusSource(deps: HttpDeps, origin: string, token: string, id: string): Promise<Result<{ text: string; spoilerText: string }>> {
  const res = await send(deps, { method: 'GET', url: `${origin}/api/v1/statuses/${encodeURIComponent(id)}/source`, headers: { ...bearer(token), accept: 'application/json' }, write: false });
  if (!res.ok) return fail(res.error);
  const j = res.value.json as Record<string, unknown>;
  if (typeof j.text !== 'string') return invalidResponse('Status source answered without text', res.value.status);
  return ok({ text: j.text, spoilerText: typeof j.spoiler_text === 'string' ? j.spoiler_text : '' }, res.rate);
}

/** Reads a status back with its exact source text, for the ledger and for delivery checks. */
export async function readBack(deps: HttpDeps, origin: string, token: string, id: string): Promise<Result<StatusReadBack>> {
  const status = await getStatus(deps, origin, token, id);
  if (!status.ok) return status;
  const source = await getStatusSource(deps, origin, token, id);
  let sourceText: string | null = null;
  if (source.ok) sourceText = source.value.text;
  else if (source.error.kind !== 'not_found') return fail(source.error); // 404 = instance without a source endpoint
  return ok({ ...status.value, sourceText, plainText: htmlToText(status.value.contentHtml) }, status.rate);
}

export async function deleteStatus(deps: HttpDeps, origin: string, token: string, id: string): Promise<Result<{ alreadyGone: boolean; text: string | null }>> {
  const res = await send(deps, { method: 'DELETE', url: `${origin}/api/v1/statuses/${encodeURIComponent(id)}?delete_media=true`, headers: { ...bearer(token), accept: 'application/json' }, write: true });
  if (!res.ok) {
    // 404 after an earlier delete or a lost answer: the status is not there.
    if (res.error.kind === 'not_found') return ok({ alreadyGone: true, text: null });
    return fail(res.error);
  }
  const j = res.value.json as Record<string, unknown>;
  return ok({ alreadyGone: false, text: typeof j.text === 'string' ? j.text : null }, res.rate);
}

/** Instances normalise line endings and trim the ends of a status. */
function sameText(a: string, b: string): boolean {
  const n = (s: string): string => s.replace(/\r\n?/g, '\n').trim();
  return n(a) === n(b);
}

export interface FindCriteria {
  accountId: string;
  text: string;
  spoilerText?: string;
  inReplyToId?: string | null;
  /** Only statuses created at or after this time (epoch ms) are candidates. */
  sinceMs: number;
  /** Candidate statuses read from the account's recent posts. Default 40. */
  limit?: number;
}

/**
 * Looks for a status the account already posted with this exact text, for the case where the
 * answer to a post was lost and the idempotency key is no longer remembered (it is kept one hour).
 * Candidates are the account's recent statuses created since sinceMs; each is compared on its exact
 * source text, content warning and reply parent.
 */
export async function findPostedStatus(deps: HttpDeps, origin: string, token: string, c: FindCriteria): Promise<Result<PostedStatus | null>> {
  const q = new URLSearchParams({ limit: String(c.limit ?? 40), exclude_reblogs: 'true' });
  const res = await send(deps, { method: 'GET', url: `${origin}/api/v1/accounts/${encodeURIComponent(c.accountId)}/statuses?${q.toString()}`, headers: { ...bearer(token), accept: 'application/json' }, write: false });
  if (!res.ok) return fail(res.error);
  if (!Array.isArray(res.value.json)) return invalidResponse('Account statuses answered with something other than a list', res.value.status);
  for (const raw of res.value.json as unknown[]) {
    const status = parseStatus(raw);
    if (!status) continue;
    if (Date.parse(status.createdAt) < c.sinceMs) continue;
    if (status.spoilerText !== (c.spoilerText ?? '')) continue;
    if (c.inReplyToId !== undefined && status.inReplyToId !== c.inReplyToId) continue;
    const src = await getStatusSource(deps, origin, token, status.id);
    if (!src.ok) return fail(src.error);
    if (sameText(src.value.text, c.text)) return ok(status);
  }
  return ok(null);
}
