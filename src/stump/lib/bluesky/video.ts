// Video through the Bluesky video service: the recommended path, which processes the file before the
// post exists. The simple path (uploadBlob of a video/mp4 file, then the post) needs no service.
//
// Sources:
//   Uploading video, both methods, service token (aud did:web:<pds host>, lxm
//     com.atproto.repo.uploadBlob, 30 minutes), upload to the video service, poll the job until it
//     returns the blob, already_exists handling:
//     https://github.com/bluesky-social/bsky-docs/blob/main/docs/tutorials/video.mdx
//   Lexicons com.atproto.server.getServiceAuth, app.bsky.video.uploadVideo, getJobStatus, defs#jobStatus:
//     https://github.com/bluesky-social/atproto/tree/main/lexicons/com/atproto/server
//     https://github.com/bluesky-social/atproto/tree/main/packages/api/lexicons/app/bsky/video

import { fail, invalidResponse, ok, type Result } from './errors.ts';
import { judge, sendRaw, type HttpDeps } from './http.ts';
import type { BlobRef } from './types.ts';
import type { Transport } from './xrpc.ts';

export const VIDEO_SERVICE = 'https://video.bsky.app';

export interface VideoDeps extends HttpDeps {
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for processing. Default 5 minutes. */
  processingTimeoutMs?: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function blobOf(json: unknown): BlobRef | null {
  const j = json as { jobStatus?: { blob?: BlobRef }; blob?: BlobRef } | undefined;
  const b = j?.jobStatus?.blob ?? j?.blob;
  return b && b.$type === 'blob' && typeof b.ref?.$link === 'string' ? b : null;
}

export async function uploadVideoViaService(
  t: Transport,
  deps: VideoDeps,
  input: { did: string; pdsUrl: string; data: Uint8Array; name: string; videoServiceUrl?: string },
): Promise<Result<BlobRef>> {
  const service = (input.videoServiceUrl ?? VIDEO_SERVICE).replace(/\/+$/, '');
  const now = deps.now ?? Date.now;
  const exp = Math.floor(now() / 1000) + 30 * 60;
  const auth = await t.call({
    nsid: 'com.atproto.server.getServiceAuth',
    method: 'GET',
    query: { aud: `did:web:${new URL(input.pdsUrl).host}`, lxm: 'com.atproto.repo.uploadBlob', exp: String(exp) },
    write: false,
  });
  if (!auth.ok) return fail(auth.error);
  const token = (auth.value.json as Record<string, unknown>).token;
  if (typeof token !== 'string') return invalidResponse('getServiceAuth answered without a token', auth.value.status);

  const q = new URLSearchParams({ did: input.did, name: input.name });
  const up = { method: 'POST', url: `${service}/xrpc/app.bsky.video.uploadVideo?${q.toString()}`, headers: { authorization: `Bearer ${token}`, 'content-type': 'video/mp4', accept: 'application/json' }, body: input.data, write: false } as const;
  const upRaw = await sendRaw(deps, up);
  // A file the service has already processed answers with an error that still carries the blob.
  if (!upRaw.thrown) {
    const early = blobOf(upRaw.json);
    if (early) return ok(early);
  }
  const upRes = judge(deps, up, upRaw);
  if (!upRes.ok) return fail(upRes.error);
  const job = (upRes.value.json as { jobStatus?: { jobId?: string } }).jobStatus;
  if (!job?.jobId) return invalidResponse('uploadVideo answered without a job', upRes.value.status);

  const sleep = deps.sleep ?? realSleep;
  const deadline = now() + (deps.processingTimeoutMs ?? 5 * 60_000);
  for (;;) {
    if (now() >= deadline) {
      return fail({ kind: 'server_error', code: 'video_processing_timeout', message: `Video job ${job.jobId} is still processing after the wait; it can be polled again`, outcomeUnknown: false });
    }
    await sleep(1000);
    const req = { method: 'GET', url: `${service}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(job.jobId)}`, headers: { accept: 'application/json' }, write: false } as const;
    const raw = await sendRaw(deps, req);
    if (!raw.thrown) {
      const blob = blobOf(raw.json);
      if (blob) return ok(blob);
      const status = (raw.json as { jobStatus?: { state?: string; error?: string; message?: string; failureCode?: string } } | undefined)?.jobStatus;
      if (status?.state === 'JOB_STATE_FAILED') {
        return fail({ kind: 'validation', code: status.failureCode ?? status.error ?? 'video_job_failed', message: status.message ?? status.error ?? 'The video service could not process the file', outcomeUnknown: false });
      }
    }
    const res = judge(deps, req, raw);
    if (!res.ok && res.error.kind !== 'server_error' && res.error.kind !== 'network_error') return fail(res.error);
  }
}
