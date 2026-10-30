/**
 * Stump's LinkedIn member-posting library. Pure TypeScript for the Workers runtime:
 * every call takes an injected fetch, and nothing here touches storage, routes or UI.
 */
export type {
  FetchFn, LinkedInContext, LinkedInError, LinkedInErrorKind, LinkedInOutcome, LinkedInRetryAdvice,
} from './types'

export { LINKEDIN_API_BASE, LINKEDIN_API_VERSION } from './http'
export { classifyLinkedInResponse, classifyLinkedInThrown, localLinkedInError, nextUtcMidnight } from './errors'

export {
  LINKEDIN_AUTHORIZE_URL, LINKEDIN_MEMBER_SCOPES, LINKEDIN_TOKEN_URL, buildLinkedInAuthorizeUrl, createLinkedInState,
  exchangeLinkedInCode, linkedInTokenStatus, parseLinkedInCallback, refreshLinkedInToken,
} from './oauth'
export type { LinkedInAppKeys, LinkedInTokenSet, LinkedInTokenStatus } from './oauth'

export { getLinkedInMember, linkedInPersonUrn } from './userinfo'
export type { LinkedInMember } from './userinfo'

export {
  LINKEDIN_COMMENTARY_MAX, checkLinkedInText, escapeLinkedInText, linkedInMention, unescapeLinkedInText,
} from './text'
export type { LinkedInTextCheck } from './text'

export { LINKEDIN_MEMBER_DAILY_LIMIT, estimateLinkedInRequests, evaluateLinkedInDailyQuota, linkedInDayWindow } from './limits'
export type { LinkedInQuotaDecision } from './limits'

export { LINKEDIN_ALT_TEXT_MAX, LINKEDIN_IMAGE_TYPES, initializeLinkedInImageUpload, isLinkedInUploadUrl, uploadLinkedInImage } from './images'
export type { LinkedInImageUpload, LinkedInImageUploadStart } from './images'

export {
  createLinkedInPost, deleteLinkedInPost, findOwnLinkedInPostByText, getLinkedInPost, linkedInCommentary, linkedInPostUrl,
  validateLinkedInPost,
} from './posts'
export type { LinkedInArticleInput, LinkedInImageRef, LinkedInPostInput, LinkedInPostReadback, LinkedInPostRef } from './posts'

export { LINKEDIN_HOSTS, checkLinkedInAppKeys, describeLinkedInApp, maskLinkedInSecret } from './setup'
export type { LinkedInAppSetup } from './setup'
