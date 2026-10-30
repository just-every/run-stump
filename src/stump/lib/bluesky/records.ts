// Repository records: create, read back, delete, list, and blob upload.
//
// Sources (lexicons, https://github.com/bluesky-social/atproto/tree/main/lexicons/com/atproto/repo):
//   com.atproto.repo.createRecord  {repo, collection, rkey?, validate?, record, swapCommit?} -> {uri, cid, commit?}
//   com.atproto.repo.getRecord     ?repo&collection&rkey[&cid] -> {uri, cid?, value}; RecordNotFound; no auth needed
//   com.atproto.repo.deleteRecord  {repo, collection, rkey, swapRecord?, swapCommit?}; "or ensure it doesn't exist"
//   com.atproto.repo.listRecords   ?repo&collection&limit(1-100)&cursor&reverse -> {cursor?, records[{uri, cid, value}]}
//   com.atproto.repo.uploadBlob    raw body with Content-Type -> {blob}; unreferenced blobs are removed after minutes
// Walkthrough with the same shapes: https://docs.bsky.app/docs/advanced-guides/posts
// PDS blob upload limit 52,428,800 bytes: https://docs.bsky.app/docs/advanced-guides/rate-limits

import { fail, invalidResponse, ok, type Result } from './errors.ts';
import type { Transport } from './xrpc.ts';
import type { BlobRef } from './types.ts';

export const POST_COLLECTION = 'app.bsky.feed.post';
export const PDS_BLOB_LIMIT = 52_428_800;

export interface RecordRef {
  uri: string;
  cid: string;
}

export async function createRecord(t: Transport, input: { repo: string; collection: string; rkey?: string; record: unknown }): Promise<Result<RecordRef>> {
  const body: Record<string, unknown> = { repo: input.repo, collection: input.collection, record: input.record };
  if (input.rkey) body.rkey = input.rkey;
  const res = await t.call({ nsid: 'com.atproto.repo.createRecord', method: 'POST', json: body, write: true });
  if (!res.ok) return fail(res.error);
  const j = res.value.json as Record<string, unknown>;
  if (typeof j.uri !== 'string' || typeof j.cid !== 'string') {
    // The PDS accepted something but did not say what: the post may exist.
    return fail({ kind: 'unknown_outcome', code: 'unreadable_answer', status: res.value.status, message: 'createRecord answered without uri and cid', outcomeUnknown: true });
  }
  return ok({ uri: j.uri, cid: j.cid }, res.rate);
}

export interface StoredRecord {
  uri: string;
  cid: string | null;
  value: unknown;
}

export async function getRecord(t: Transport, input: { repo: string; collection: string; rkey: string }): Promise<Result<StoredRecord>> {
  const res = await t.call({ nsid: 'com.atproto.repo.getRecord', method: 'GET', query: { repo: input.repo, collection: input.collection, rkey: input.rkey }, write: false, authenticated: false });
  if (!res.ok) return fail(res.error);
  const j = res.value.json as Record<string, unknown>;
  if (typeof j.uri !== 'string' || j.value === undefined) return invalidResponse('getRecord answered without uri and value', res.value.status);
  return ok({ uri: j.uri, cid: typeof j.cid === 'string' ? j.cid : null, value: j.value }, res.rate);
}

/** Deletes a record. A record that is already gone counts as deleted. */
export async function deleteRecord(t: Transport, input: { repo: string; collection: string; rkey: string }): Promise<Result<{ alreadyGone: boolean }>> {
  const check = await getRecord(t, input);
  if (!check.ok && check.error.kind === 'not_found') return ok({ alreadyGone: true });
  if (!check.ok) return fail(check.error);
  const res = await t.call({ nsid: 'com.atproto.repo.deleteRecord', method: 'POST', json: input, write: true, allowEmpty: true });
  if (!res.ok) return fail(res.error);
  return ok({ alreadyGone: false }, res.rate);
}

export async function listRecords(
  t: Transport,
  input: { repo: string; collection: string; limit?: number; cursor?: string },
): Promise<Result<{ records: StoredRecord[]; cursor: string | null }>> {
  const query: Record<string, string> = { repo: input.repo, collection: input.collection, limit: String(input.limit ?? 50) };
  if (input.cursor) query.cursor = input.cursor;
  const res = await t.call({ nsid: 'com.atproto.repo.listRecords', method: 'GET', query, write: false, authenticated: false });
  if (!res.ok) return fail(res.error);
  const j = res.value.json as Record<string, unknown>;
  if (!Array.isArray(j.records)) return invalidResponse('listRecords answered without records', res.value.status);
  const records = (j.records as Array<Record<string, unknown>>)
    .filter((r) => typeof r.uri === 'string' && r.value !== undefined)
    .map((r) => ({ uri: r.uri as string, cid: typeof r.cid === 'string' ? r.cid : null, value: r.value }));
  return ok({ records, cursor: typeof j.cursor === 'string' ? j.cursor : null }, res.rate);
}

export async function uploadBlob(t: Transport, data: Uint8Array, mimeType: string): Promise<Result<BlobRef>> {
  if (data.byteLength === 0) return fail({ kind: 'validation', code: 'blob_empty', message: 'The file is empty', outcomeUnknown: false });
  if (data.byteLength > PDS_BLOB_LIMIT) {
    return fail({ kind: 'validation', code: 'blob_too_large', message: `${data.byteLength} bytes; a PDS accepts ${PDS_BLOB_LIMIT}`, outcomeUnknown: false });
  }
  // An upload that is lost is simply sent again; unreferenced blobs are cleaned up by the PDS.
  const res = await t.call({ nsid: 'com.atproto.repo.uploadBlob', method: 'POST', bytes: { data, contentType: mimeType }, write: false });
  if (!res.ok) return fail(res.error);
  const blob = (res.value.json as Record<string, unknown>).blob as Partial<BlobRef> | undefined;
  if (!blob || blob.$type !== 'blob' || typeof blob.ref?.$link !== 'string' || typeof blob.mimeType !== 'string' || typeof blob.size !== 'number') {
    return invalidResponse('uploadBlob answered without a blob reference', res.value.status);
  }
  return ok(blob as BlobRef, res.rate);
}
