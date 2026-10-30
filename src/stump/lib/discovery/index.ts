/**
 * Discovery library: sources, term logic, screening, ranking and alerts for Stump's watches.
 * STUMP-WATCH-001, -002, -003, -004, -005, -013. Pure TypeScript for the Workers runtime; every
 * network call takes the caller's `fetch`. No storage, no routes, no screens.
 */
export type { CommonOptions, DeliveryResult, FetchFn, Finding, HandleRef, SourceErrorKind, SourceKind, SourceWarning } from './types.ts'
export { SourceError, describeError, type ErrorDescription } from './errors.ts'

export { compileTerms, matchTerms, hasPositiveTerms, remoteQueries, normalizeForMatch, TermError } from './terms.ts'
export type { Area, CompiledTerms, Haystack, TermLogic, TermMatch } from './terms.ts'

export { canonicalUrl, unwrapRedirect, isRedditUrl, isRedditHost, parseHttpUrl, hostOf } from './url.ts'
export { htmlToText, stripControls, truncateGraphemes, excerptTitle } from './text.ts'

export { searchHackerNews, backfillHackerNews, backfillSince, hnNextSince, hnHitToFinding, hnItemUrl, BACKFILL_DAYS, DEFAULT_HN_OVERLAP_SECONDS } from './hn.ts'
export type { HnResult, HnSearchOptions, HnStoryType } from './hn.ts'

export { parseFeed, parseFeedDate, cleanAuthor } from './feeds.ts'
export type { FeedItem, ParsedFeed, TranscriptRef } from './feeds.ts'
export { fetchFeed, pollFeed, assertFeedUrlAllowed, REDDIT_REFUSAL, DEFAULT_MIN_INTERVAL_MS } from './feed-poll.ts'
export type { FeedFetch, FeedFetchOptions, FeedPoll, FeedPollOptions, FeedValidators } from './feed-poll.ts'
export { parseTranscript, parseSrt, parseVtt, fetchTranscript, transcriptFormat } from './transcripts.ts'
export type { TranscriptResult } from './transcripts.ts'

export { searchBluesky, bskyPostToFinding, bskyPostUrl } from './bluesky.ts'
export type { BlueskyResult, BlueskySearchOptions } from './bluesky.ts'

export { pollMastodonTags, backfillMastodonTags, mastodonStatusToFinding, instanceOrigin, normalizeHashtag, compareIds, MASTODON_BACKFILL_REQUESTS } from './mastodon.ts'
export type { MastodonResult, MastodonTagOptions } from './mastodon.ts'

export { screenFindings, isListedAuthor, normalizeHandle } from './screen.ts'
export type { DropReason, Dropped, ScreenResult, ScreenSpec, SourceFilters } from './screen.ts'

export { rankFindings, scoreFinding, qualifiesForImmediateAlert } from './rank.ts'
export type { Factor, RankContext, Ranked, Reason } from './rank.ts'
export { neutralise, questionSentences } from './rank-text.ts'
export { learnFromMarks, marksAdjustment, emptyModel, featuresOf } from './marks.ts'
export type { Mark, MarksAdjustment, MarksModel } from './marks.ts'

export type { AlertFinding, AlertMessage } from './alert-types.ts'
export { buildSlackPayload, postSlackAlert, assertSlackWebhookUrl, slackEscape, SLACK_WEBHOOK_HOSTS } from './slack.ts'
export type { SlackPayload, SlackPostOptions } from './slack.ts'
export {
  signWebhook, verifyWebhookSignature, newEventId, deriveEventId, buildAlertEvent, buildWebhookRequest, deliverWebhook,
  assertWebhookUrl, EVENT_ID_HEADER, SIGNATURE_HEADER, DEFAULT_TOLERANCE_SECONDS,
} from './webhook.ts'
export type { AlertEvent, VerifyResult, WebhookDelivery, WebhookRequest } from './webhook.ts'
