// A Mastodon client for one connected account on one instance (docs: https://docs.joinmastodon.org/methods/).
// Every call goes through the injected fetch; nothing is stored here.
// The caller keeps tokens and the app registration.

import { verifyCredentials, type MastodonAccount } from './account.ts';
import { fail, validationError, type Result } from './errors.ts';
import type { FetchFn, HttpDeps } from './http.ts';
import { getInstanceInfo, normalizeInstance, type InstanceInfo } from './instance.ts';
import { uploadMedia } from './media.ts';
import { deleteStatus, findPostedStatus, getStatus, postStatus, readBack, searchStatus, type FindCriteria } from './statuses.ts';
import { checkStatusDraft } from './text.ts';
import { publishThread, type ThreadItem, type ThreadOutcome, type ThreadPosted } from './thread.ts';
import type { MediaFile, PostedStatus, StatusDraft, StatusDraftOptions, StatusReadBack, UploadedMedia } from './types.ts';

export interface MastodonClientConfig {
  fetch: FetchFn;
  /** Host or origin of the instance. */
  instance: string;
  accessToken: string;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Refuse media without alt text. Default true. */
  requireAltText?: boolean;
}

export interface MastodonClient {
  readonly origin: string;
  /** The instance's own limits and rules, read once and kept for this client's life. */
  instance(): Promise<Result<InstanceInfo>>;
  account(): Promise<Result<MastodonAccount>>;
  /** Checks a draft against the instance's limits; sends nothing. */
  check(draft: StatusDraft): Promise<Result<true>>;
  uploadMedia(file: MediaFile): Promise<Result<UploadedMedia>>;
  postStatus(draft: StatusDraft, idempotencyKey: string): Promise<Result<PostedStatus>>;
  getStatus(id: string): Promise<Result<PostedStatus>>;
  readBack(id: string): Promise<Result<StatusReadBack>>;
  deleteStatus(id: string): Promise<Result<{ alreadyGone: boolean; text: string | null }>>;
  findPostedStatus(criteria: FindCriteria): Promise<Result<PostedStatus | null>>;
  /** This instance's id for a status at another instance's URL, or null when it finds none. */
  searchStatus(url: string): Promise<Result<string | null>>;
  publishThread(items: ThreadItem[], alreadyPosted?: ThreadPosted[]): Promise<ThreadOutcome>;
}

export function createMastodonClient(config: MastodonClientConfig): MastodonClient {
  const n = normalizeInstance(config.instance);
  if (!n.ok) throw new TypeError(n.message);
  const origin = n.origin;
  const deps: HttpDeps & { sleep?: (ms: number) => Promise<void> } = { fetch: config.fetch };
  if (config.timeoutMs !== undefined) deps.timeoutMs = config.timeoutMs;
  if (config.now) deps.now = config.now;
  if (config.sleep) deps.sleep = config.sleep;
  const options: StatusDraftOptions = { requireAltText: config.requireAltText ?? true };
  const token = config.accessToken;

  let info: InstanceInfo | undefined;
  const instance = async (): Promise<Result<InstanceInfo>> => {
    if (info) return { ok: true, value: info };
    const res = await getInstanceInfo(deps, origin);
    if (res.ok) info = res.value;
    return res;
  };
  const withInfo = async <T>(run: (i: InstanceInfo) => Promise<Result<T>>): Promise<Result<T>> => {
    const i = await instance();
    if (!i.ok) return fail(i.error);
    return run(i.value);
  };

  const client: MastodonClient = {
    origin,
    instance,
    account: () => withInfo((i) => verifyCredentials(deps, origin, i.domain, token)),
    check: (draft) =>
      withInfo(async (i) => {
        const problems = checkStatusDraft(draft, i, options);
        return problems.length > 0 ? validationError(problems) : { ok: true, value: true };
      }),
    uploadMedia: (file) => withInfo((i) => uploadMedia(deps, origin, token, file, i, options)),
    postStatus: (draft, key) =>
      withInfo(async (i) => {
        const problems = checkStatusDraft(draft, i, options);
        if (problems.length > 0) return validationError(problems);
        return postStatus(deps, origin, token, draft, key);
      }),
    getStatus: (id) => getStatus(deps, origin, token, id),
    readBack: (id) => readBack(deps, origin, token, id),
    deleteStatus: (id) => deleteStatus(deps, origin, token, id),
    findPostedStatus: (criteria) => findPostedStatus(deps, origin, token, criteria),
    searchStatus: (url) => searchStatus(deps, origin, token, url),
    publishThread: (items, alreadyPosted) => publishThread(client, items, alreadyPosted),
  };
  return client;
}
