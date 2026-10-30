// A Bluesky client for one connected account on its PDS. Every call goes through the injected fetch;
// nothing is stored here. The caller keeps the session (see onAuthChange) and the OAuth client key.
//
// Sources: the lexicons and guides cited in the files this one composes; account profile from the
// app.bsky.actor.profile record (displayName, description, avatar), key "self":
// https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/actor/profile.json
// and com.atproto.server.getSession.

import { fail, invalidResponse, ok, validationError, type Result } from './errors.ts';
import type { FetchFn, HttpDeps } from './http.ts';
import { resolveHandle } from './identity.ts';
import { revokeOAuth, type OAuthClientConfig } from './oauth.ts';
import { buildPostRecord, checkFacets, checkPostDraft, parseAtUri, parsePostValue, webUrlFor } from './post.ts';
import { deleteRecord, getRecord, listRecords, POST_COLLECTION, uploadBlob, createRecord } from './records.ts';
import { buildFacets, type FacetBuild } from './richtext.ts';
import { deleteSession } from './session.ts';
import { publishThread, type ThreadItem, type ThreadOutcome, type ThreadPosted } from './thread.ts';
import { tidFromKey } from './tid.ts';
import { uploadVideoViaService, type VideoDeps } from './video.ts';
import type { BlobRef, BlueskyAuth, BlueskyProfile, CreatedPost, PostDraft, PostReadBack } from './types.ts';
import { createTransport } from './xrpc.ts';
import type { Problem } from './errors.ts';

export interface BlueskyClientConfig {
  fetch: FetchFn;
  /** The account's PDS (from the session result or the DID document). */
  pdsUrl: string;
  auth: BlueskyAuth;
  /** Needed to refresh or revoke an OAuth session. */
  oauthClient?: OAuthClientConfig;
  /** Persist the new session whenever tokens change. */
  onAuthChange?: (auth: BlueskyAuth) => void | Promise<void>;
  /** Server that answers resolveHandle for mentions. Default: the PDS. */
  handleResolverUrl?: string;
  timeoutMs?: number;
  now?: () => number;
}

export interface CreatePostOptions {
  /** One key per post and account. With atMs it fixes the record key (a TID), so a retry reads back instead of posting twice. */
  idempotencyKey?: string;
  /** When the post is due (epoch ms). Default: now. */
  atMs?: number;
  /** An explicit record key, used as is. */
  rkey?: string;
}

export interface FindOptions {
  text: string;
  /** Only records created at or after this time (epoch ms). */
  sinceMs: number;
  /** Pages of 100 records to read. Default 3. */
  maxPages?: number;
}

export interface BlueskyClient {
  auth(): BlueskyAuth;
  /** The account as the PDS sees it now: current handle and whether it is active. */
  session(): Promise<Result<{ did: string; handle: string; active: boolean; status: string | null }>>;
  profile(): Promise<Result<BlueskyProfile>>;
  /** The account's follower count from app.bsky.actor.getProfile, which the PDS proxies to its AppView. */
  followers(): Promise<Result<number | null>>;
  resolveHandle(handle: string): Promise<Result<string | null>>;
  buildFacets(text: string): Promise<Result<FacetBuild>>;
  /** Problems that stop a draft being marked ready. Sends nothing. */
  check(draft: PostDraft): Problem[];
  uploadBlob(data: Uint8Array, mimeType: string): Promise<Result<BlobRef>>;
  /** Sends a video/mp4 file through the video service, which processes it before the post exists. */
  uploadVideo(data: Uint8Array, options: { name: string; videoServiceUrl?: string; sleep?: (ms: number) => Promise<void>; processingTimeoutMs?: number }): Promise<Result<BlobRef>>;
  createPost(draft: PostDraft, options?: CreatePostOptions): Promise<Result<CreatedPost>>;
  /** Reads a post back from the PDS by its at:// URI. */
  getPost(uri: string): Promise<Result<PostReadBack>>;
  deletePost(uri: string): Promise<Result<{ alreadyGone: boolean }>>;
  findPostByText(options: FindOptions): Promise<Result<PostReadBack | null>>;
  publishThread(items: ThreadItem[], alreadyPosted?: ThreadPosted[]): Promise<ThreadOutcome>;
  /**
   * Ends the session or grant at the network. For an app-password session the refresh token stops
   * working at once, but the access token already issued stays valid until accessValidUntilMs.
   */
  disconnect(): Promise<Result<{ accessValidUntilMs: number | null }>>;
}

export function createBlueskyClient(config: BlueskyClientConfig): BlueskyClient {
  const pdsUrl = config.pdsUrl.replace(/\/+$/, '');
  const deps: HttpDeps = { fetch: config.fetch };
  if (config.timeoutMs !== undefined) deps.timeoutMs = config.timeoutMs;
  if (config.now) deps.now = config.now;
  const now = config.now ?? Date.now;
  const transport = createTransport({ ...deps, pdsUrl, auth: config.auth, ...(config.oauthClient ? { oauthClient: config.oauthClient } : {}), ...(config.onAuthChange ? { onAuthChange: config.onAuthChange } : {}) });
  const resolverUrl = (config.handleResolverUrl ?? pdsUrl).replace(/\/+$/, '');
  const did = (): string => transport.auth()!.did;

  const readBack = (stored: { uri: string; cid: string | null; value: unknown }): Result<PostReadBack> => {
    const at = parseAtUri(stored.uri);
    const parsed = parsePostValue(stored.value);
    if (!at || !parsed) return invalidResponse('The record is not an app.bsky.feed.post');
    return ok({ ...parsed, uri: stored.uri, cid: stored.cid ?? '', rkey: at.rkey, repo: at.repo, webUrl: webUrlFor(at.repo, at.rkey), value: stored.value as Record<string, unknown> });
  };

  const client: BlueskyClient = {
    auth: () => transport.auth()!,
    async session() {
      const res = await transport.call({ nsid: 'com.atproto.server.getSession', method: 'GET', write: false });
      if (!res.ok) return fail(res.error);
      const j = res.value.json as Record<string, unknown>;
      if (typeof j.did !== 'string' || typeof j.handle !== 'string') return invalidResponse('getSession answered without did and handle', res.value.status);
      return ok({ did: j.did, handle: j.handle, active: j.active !== false, status: typeof j.status === 'string' ? j.status : null }, res.rate);
    },
    async profile() {
      const s = await client.session();
      if (!s.ok) return fail(s.error);
      const rec = await getRecord(transport, { repo: s.value.did, collection: 'app.bsky.actor.profile', rkey: 'self' });
      if (!rec.ok && rec.error.kind !== 'not_found') return fail(rec.error);
      const v = rec.ok && rec.value.value && typeof rec.value.value === 'object' ? (rec.value.value as Record<string, unknown>) : {};
      return ok({
        did: s.value.did,
        handle: s.value.handle,
        displayName: typeof v.displayName === 'string' && v.displayName !== '' ? v.displayName : s.value.handle,
        description: typeof v.description === 'string' ? v.description : '',
        avatar: v.avatar && typeof v.avatar === 'object' ? (v.avatar as BlobRef) : null,
        hasProfileRecord: rec.ok,
      });
    },
    async followers() {
      const res = await transport.call({ nsid: 'app.bsky.actor.getProfile', method: 'GET', query: { actor: did() }, write: false });
      if (!res.ok) return fail(res.error);
      const count = (res.value.json as Record<string, unknown>).followersCount;
      return ok(typeof count === 'number' ? count : null, res.rate);
    },
    resolveHandle: (handle) => resolveHandle(deps, resolverUrl, handle),
    async buildFacets(text) {
      const failures: Array<ReturnType<typeof fail>> = [];
      const build = await buildFacets(text, async (h) => {
        const r = await resolveHandle(deps, resolverUrl, h);
        if (!r.ok) {
          failures.push(fail(r.error));
          return null;
        }
        return r.value;
      });
      // A handle that failed to resolve for a real reason (rate limit, outage) must not be dropped as "not found".
      if (failures[0]) return failures[0];
      return ok(build);
    },
    check: (draft) => checkPostDraft(draft),
    uploadBlob: (data, mimeType) => uploadBlob(transport, data, mimeType),
    uploadVideo: (data, options) => {
      const vdeps: VideoDeps = { ...deps };
      if (options.sleep) vdeps.sleep = options.sleep;
      if (options.processingTimeoutMs !== undefined) vdeps.processingTimeoutMs = options.processingTimeoutMs;
      const input: Parameters<typeof uploadVideoViaService>[2] = { did: did(), pdsUrl, data, name: options.name };
      if (options.videoServiceUrl) input.videoServiceUrl = options.videoServiceUrl;
      return uploadVideoViaService(transport, vdeps, input);
    },
    async createPost(draft, options = {}) {
      const problems = checkPostDraft(draft);
      if (problems.length > 0) return validationError(problems);
      let facets = draft.facets;
      if (!facets) {
        const built = await client.buildFacets(draft.text);
        if (!built.ok) return fail(built.error);
        facets = built.value.facets;
        const bad = checkFacets(draft.text, facets);
        if (bad.length > 0) return validationError(bad);
      }
      const atMs = options.atMs ?? now();
      const rkey = options.rkey ?? (options.idempotencyKey ? await tidFromKey(options.idempotencyKey, atMs) : undefined);
      const record = buildPostRecord(draft, facets, draft.createdAt ?? new Date(atMs).toISOString());
      const repo = did();
      const created = await createRecord(transport, { repo, collection: POST_COLLECTION, ...(rkey ? { rkey } : {}), record });
      if (created.ok) {
        const at = parseAtUri(created.value.uri);
        const key = at?.rkey ?? rkey ?? '';
        return ok({ uri: created.value.uri, cid: created.value.cid, rkey: key, repo, webUrl: webUrlFor(repo, key), record, recoveredByKey: false }, created.rate);
      }
      // A key was given, so the post has a known address. When the answer was refused or lost, look there:
      // a record holding this post's text is this post (the same key sent twice, or an answer that never
      // arrived), and nothing new is created. If nothing is there the original failure stands, and an
      // unknown outcome stays unknown for the owner to settle.
      if (rkey && (created.error.kind === 'validation' || created.error.kind === 'unknown_outcome' || created.error.kind === 'server_error')) {
        const existing = await getRecord(transport, { repo, collection: POST_COLLECTION, rkey });
        if (existing.ok) {
          const back = readBack(existing.value);
          if (back.ok && back.value.text === draft.text) {
            return ok({ uri: back.value.uri, cid: back.value.cid, rkey, repo, webUrl: back.value.webUrl, record, recoveredByKey: true });
          }
        }
      }
      return fail(created.error);
    },
    async getPost(uri) {
      const at = parseAtUri(uri);
      if (!at) return validationError([{ code: 'uri_invalid', message: `${uri} is not an at:// record address`, path: 'uri' }]);
      const rec = await getRecord(transport, { repo: at.repo, collection: at.collection, rkey: at.rkey });
      if (!rec.ok) return fail(rec.error);
      const back = readBack(rec.value);
      return back.ok && rec.rate ? ok(back.value, rec.rate) : back;
    },
    async deletePost(uri) {
      const at = parseAtUri(uri);
      if (!at || at.collection !== POST_COLLECTION) return validationError([{ code: 'uri_invalid', message: `${uri} is not a post address`, path: 'uri' }]);
      if (at.repo !== did() && at.repo !== (transport.auth() as { handle?: string } | null)?.handle) {
        return validationError([{ code: 'not_own_post', message: 'Only the connected account\'s own posts can be deleted', path: 'uri' }]);
      }
      return deleteRecord(transport, { repo: did(), collection: POST_COLLECTION, rkey: at.rkey });
    },
    async findPostByText(options) {
      let cursor: string | undefined;
      for (let page = 0; page < (options.maxPages ?? 3); page++) {
        const res = await listRecords(transport, { repo: did(), collection: POST_COLLECTION, limit: 100, ...(cursor ? { cursor } : {}) });
        if (!res.ok) return fail(res.error);
        for (const r of res.value.records) {
          const back = readBack(r);
          if (!back.ok) continue;
          const created = back.value.createdAt ? Date.parse(back.value.createdAt) : NaN;
          if (!Number.isNaN(created) && created >= options.sinceMs && back.value.text === options.text) return ok(back.value);
        }
        if (!res.value.cursor) break;
        cursor = res.value.cursor;
      }
      return ok(null);
    },
    publishThread: (items, alreadyPosted) => publishThread(client, items, alreadyPosted),
    async disconnect() {
      const a = transport.auth()!;
      if (a.kind === 'password') {
        const r = await deleteSession(deps, pdsUrl, a.refreshJwt);
        return r.ok ? ok({ accessValidUntilMs: a.accessExpiresAtMs }) : fail(r.error);
      }
      if (!config.oauthClient) return fail({ kind: 'validation', code: 'oauth_client_missing', message: 'Revoking an OAuth session needs the OAuth client configuration', outcomeUnknown: false });
      const r = await revokeOAuth(deps, config.oauthClient, a);
      return r.ok ? ok({ accessValidUntilMs: null }) : fail(r.error);
    },
  };
  return client;
}
