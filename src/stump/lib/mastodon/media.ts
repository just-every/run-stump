// Media upload (v2, asynchronous) with alt text.
//
// Source: https://docs.joinmastodon.org/methods/media/
//   POST /api/v2/media  multipart: file, description, focus. 200 = ready, 202 = still processing (url null).
//   GET  /api/v1/media/:id  200 = ready, 206 = still processing, 422 = processing failed.
//   Media uploads are limited to 30 per 30 minutes: https://docs.joinmastodon.org/api/rate-limits/

import { checkMedia } from './media-check.ts';
import { fail, invalidResponse, ok, validationError, type NetworkError, type Result } from './errors.ts';
import { bearer, send, type HttpDeps } from './http.ts';
import type { InstanceInfo } from './instance.ts';
import type { MediaFile, StatusDraftOptions, UploadedMedia } from './types.ts';

export interface MediaDeps extends HttpDeps {
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the instance to finish processing. Default 60000. */
  processingTimeoutMs?: number;
}

function parseMedia(json: unknown): UploadedMedia | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  if (typeof j.id !== 'string') return null;
  return {
    id: j.id,
    type: typeof j.type === 'string' ? j.type : 'unknown',
    url: typeof j.url === 'string' ? j.url : null,
    previewUrl: typeof j.preview_url === 'string' ? j.preview_url : null,
    description: typeof j.description === 'string' ? j.description : null,
  };
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function uploadMedia(
  deps: MediaDeps,
  origin: string,
  token: string,
  file: MediaFile,
  info: InstanceInfo | null,
  options: StatusDraftOptions = {},
): Promise<Result<UploadedMedia>> {
  if (info) {
    const problems = checkMedia(file, info, options);
    if (problems.length > 0) return validationError(problems);
  }
  const blob = file.bytes instanceof Blob ? file.bytes : new Blob([file.bytes as BlobPart], { type: file.mimeType });
  const typed = blob.type === file.mimeType ? blob : new Blob([blob], { type: file.mimeType });
  const form = new FormData();
  form.append('file', typed, file.filename ?? 'upload');
  if (file.description) form.append('description', file.description);
  if (file.focus) form.append('focus', `${file.focus.x},${file.focus.y}`);
  const res = await send(deps, { method: 'POST', url: `${origin}/api/v2/media`, headers: { ...bearer(token), accept: 'application/json' }, body: form, write: true });
  if (!res.ok) return fail(res.error);
  const media = parseMedia(res.value.json);
  if (!media) return invalidResponse('Media upload answered without an attachment id', res.value.status);
  // 200 means the full-size file is ready; 202 means it is still processing and url is null.
  if (res.value.status === 200 && media.url !== null) return ok(media, res.rate);
  return waitForProcessing(deps, origin, token, media);
}

async function waitForProcessing(deps: MediaDeps, origin: string, token: string, first: UploadedMedia): Promise<Result<UploadedMedia>> {
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.processingTimeoutMs ?? 60_000);
  let delay = 500;
  for (;;) {
    if (now() >= deadline) {
      const e: NetworkError = { kind: 'server_error', code: 'media_processing_timeout', message: `${first.id} is still processing after the wait; the attachment can be polled again`, outcomeUnknown: false };
      return fail(e);
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 5000);
    const res = await send(deps, { method: 'GET', url: `${origin}/api/v1/media/${encodeURIComponent(first.id)}`, headers: { ...bearer(token), accept: 'application/json' }, write: false });
    if (!res.ok) return fail(res.error);
    if (res.value.status === 206) continue;
    const media = parseMedia(res.value.json);
    if (!media) return invalidResponse('Media poll answered without an attachment', res.value.status);
    if (media.url === null) continue;
    return ok(media, res.rate);
  }
}
