// Mastodon: a pure leaf library. App registration, OAuth, the instance's own limits, statuses with
// idempotency keys, media with alt text, polls, threads, read-back, delete, the bot flag, and
// classified failures. Every call takes an injected fetch; nothing here stores anything.
//
// Documentation read for this library: https://docs.joinmastodon.org/ (methods/apps, methods/oauth,
// methods/instance, methods/accounts, methods/statuses, methods/media, entities/Status, entities/Account,
// api/rate-limits, api/guidelines) and Mastodon's StatusLengthValidator source for how length is counted.

export { createMastodonClient } from './client.ts';
export type { MastodonClient, MastodonClientConfig } from './client.ts';

export { normalizeInstance, getInstanceInfo, parseInstance, rulesRequiringBotFlag } from './instance.ts';
export type { InstanceInfo, InstanceRule } from './instance.ts';

export { registerApp, buildAuthorizeUrl, exchangeCode, revokeToken, createPkce, randomToken, DEFAULT_SCOPES } from './oauth.ts';
export type { RegisteredApp, AuthorizeUrlInput, AccessToken } from './oauth.ts';

export { verifyCredentials, parseAccount } from './account.ts';
export type { MastodonAccount } from './account.ts';

export { statusLength, countableText, graphemeLength, checkStatusDraft, checkPoll, htmlToText } from './text.ts';
export { checkMedia } from './media-check.ts';
export { uploadMedia } from './media.ts';
export { postStatus, getStatus, getStatusSource, readBack, deleteStatus, findPostedStatus, parseStatus } from './statuses.ts';
export type { FindCriteria } from './statuses.ts';
export { publishThread } from './thread.ts';
export type { ThreadItem, ThreadPosted, ThreadOutcome, ThreadPoster } from './thread.ts';

export { classifyResponse, classifyThrown, parseInstant, parseRateLimit, validationError } from './errors.ts';
export type { Result, Ok, Err, NetworkError, ErrorKind, RateLimitInfo, Problem } from './errors.ts';
export type { FetchFn } from './http.ts';
export type {
  Visibility,
  PollDraft,
  MediaFile,
  UploadedMedia,
  StatusDraft,
  StatusDraftOptions,
  PostedStatus,
  PostedPoll,
  StatusReadBack,
} from './types.ts';
