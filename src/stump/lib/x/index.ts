/**
 * Stump's X (Twitter) API v2 library. Pure TypeScript for the Workers runtime:
 * every call takes an injected fetch, and nothing here touches storage, routes or UI.
 */
export type {
  FetchFn, RateLimit, XChargeAct, XChargeQuote, XContext, XError, XErrorKind, XPriceTable, XResult, XRetryAdvice,
} from './types'

export { X_DEFAULT_PRICES, postHasUrl, quoteXPost, quoteXRead, quoteXThread, sumCharges, validateXPriceTable } from './charge'
export type { XPriceValidation } from './charge'

export { X_DEFAULT_POST_LIMIT, X_URL_WEIGHT, checkXLength, xWeightedLength } from './length'
export type { XLengthCheck } from './length'
export { extractUrls } from './urls'
export type { UrlSpan } from './urls'

export { classifyXResponse, classifyXThrown, localXError, parseRateLimit } from './errors'
export { X_API_BASE } from './http'

export {
  X_AUTHORIZE_URL, X_DEFAULT_SCOPES, buildXAuthorizeUrl, createOAuthState, createPkcePair, ensureFreshXTokens,
  exchangeXCode, parseXCallback, refreshXTokens, revokeXToken, xTokenNeedsRefresh,
} from './oauth'
export type { XAppKeys, XAuthorizeInput, XTokenSet } from './oauth'

export { getXMe } from './users'
export type { XUser } from './users'

export { X_ALT_TEXT_MAX, checkXAltText, uploadXMedia, xMediaCategoryFor } from './media'
export type { XMediaCategory, XMediaUploadInput, XMediaUploaded } from './media'

export { X_POLL_LIMITS, createXPost, deleteXPost, findOwnXPostByText, getXPost, publishXThread, validateXPost } from './posts'
export type { XFindInput, XPollInput, XPostInput, XPosted, XReadOptions, XThreadInput, XThreadPosted, XThreadResult } from './posts'

export { normalizeXText, unescapeXText, xPostUrl } from './readback'
export type { XMediaReadback, XPollReadback, XPostReadback } from './readback'

export { compareXIds, dedupeXPosts, fetchXMentions } from './mentions'
export type { XMention, XMentionAuthor, XMentionsInput, XMentionsPoll } from './mentions'

export { X_HOSTS, checkXAppKeys, describeXApp, maskSecret } from './setup'
export type { XAppKeyCheck, XAppSetup } from './setup'
