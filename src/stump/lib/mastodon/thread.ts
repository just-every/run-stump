// Threads as reply chains: each post replies to the one before it (in_reply_to_id).
// Source: https://docs.joinmastodon.org/methods/statuses/ (in_reply_to_id)

import type { NetworkError } from './errors.ts';
import type { PostedStatus, StatusDraft } from './types.ts';

export interface ThreadItem {
  /** Idempotency key of this post. One key per post, stable across retries and resumes. */
  key: string;
  draft: Omit<StatusDraft, 'inReplyToId'>;
}

export interface ThreadPosted {
  key: string;
  status: Pick<PostedStatus, 'id' | 'url' | 'uri'> & Partial<PostedStatus>;
}

export interface ThreadOutcome {
  /** Every post that exists, in order, including those passed in as already posted. */
  posted: ThreadPosted[];
  /** The first post that did not go out, with the network's error. Nothing after it was tried. */
  failure: { index: number; key: string; error: NetworkError } | null;
  complete: boolean;
}

export interface ThreadPoster {
  postStatus(draft: StatusDraft, idempotencyKey: string): Promise<import('./errors.ts').Result<PostedStatus>>;
}

/**
 * Posts a thread in order and stops at the first failure, so the earlier posts stay and the thread
 * reads as partly posted. Pass what is already posted to resume: those posts are skipped and the
 * first unposted one replies to the last posted. The already-posted list must be a prefix of items.
 */
export async function publishThread(poster: ThreadPoster, items: ThreadItem[], alreadyPosted: ThreadPosted[] = []): Promise<ThreadOutcome> {
  alreadyPosted.forEach((p, i) => {
    if (items[i]?.key !== p.key) throw new Error(`alreadyPosted[${i}] (${p.key}) is not item ${i} of the thread`);
  });
  const posted: ThreadPosted[] = [...alreadyPosted];
  for (let i = alreadyPosted.length; i < items.length; i++) {
    const item = items[i]!;
    const parent = posted[posted.length - 1];
    const draft: StatusDraft = parent ? { ...item.draft, inReplyToId: parent.status.id } : { ...item.draft };
    const res = await poster.postStatus(draft, item.key);
    if (!res.ok) return { posted, failure: { index: i, key: item.key, error: res.error }, complete: false };
    posted.push({ key: item.key, status: res.value });
  }
  return { posted, failure: null, complete: true };
}
