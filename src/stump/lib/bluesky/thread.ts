// Threads as reply chains: every post carries reply.root (the first post) and reply.parent (the one before).
// Source: https://docs.bsky.app/docs/advanced-guides/posts (Replies) and the replyRef definition in
// https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/feed/post.json

import type { NetworkError, Result } from './errors.ts';
import type { CreatedPost, PostDraft, StrongRef } from './types.ts';

export interface ThreadItem {
  /** Idempotency key of this post. One key per post, stable across retries and resumes. */
  key: string;
  /** The moment the post is due. With the key it fixes the record key, so a retry targets the same record. */
  atMs?: number;
  draft: Omit<PostDraft, 'reply'>;
}

export interface ThreadPosted {
  key: string;
  uri: string;
  cid: string;
}

export interface ThreadOutcome {
  /** Every post that exists, in order, including those passed in as already posted. */
  posted: ThreadPosted[];
  /** The first post that did not go out, with the network's error. Nothing after it was tried. */
  failure: { index: number; key: string; error: NetworkError } | null;
  complete: boolean;
}

export interface ThreadPoster {
  createPost(draft: PostDraft, options: { idempotencyKey: string; atMs?: number }): Promise<Result<CreatedPost>>;
}

/**
 * Posts a thread in order and stops at the first failure, so the earlier posts stay and the thread
 * reads as partly posted. Pass what is already posted to resume: those posts are skipped and the
 * first unposted one replies to the last posted, under the same root. The already-posted list must
 * be a prefix of items.
 */
export async function publishThread(poster: ThreadPoster, items: ThreadItem[], alreadyPosted: ThreadPosted[] = []): Promise<ThreadOutcome> {
  alreadyPosted.forEach((p, i) => {
    if (items[i]?.key !== p.key) throw new Error(`alreadyPosted[${i}] (${p.key}) is not item ${i} of the thread`);
  });
  const posted: ThreadPosted[] = [...alreadyPosted];
  for (let i = alreadyPosted.length; i < items.length; i++) {
    const item = items[i]!;
    const root: StrongRef | undefined = posted[0] ? { uri: posted[0].uri, cid: posted[0].cid } : undefined;
    const parent = posted[posted.length - 1];
    const draft: PostDraft = root && parent ? { ...item.draft, reply: { root, parent: { uri: parent.uri, cid: parent.cid } } } : { ...item.draft };
    const options: { idempotencyKey: string; atMs?: number } = { idempotencyKey: item.key };
    if (item.atMs !== undefined) options.atMs = item.atMs;
    const res = await poster.createPost(draft, options);
    if (!res.ok) return { posted, failure: { index: i, key: item.key, error: res.error }, complete: false };
    posted.push({ key: item.key, uri: res.value.uri, cid: res.value.cid });
  }
  return { posted, failure: null, complete: true };
}
