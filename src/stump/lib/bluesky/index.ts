// Bluesky (atproto): a pure leaf library. Connect with an app password or atproto OAuth, post with
// facets at UTF-8 byte offsets, threads, images and video with alt text, read back, delete, and
// classified failures. Every call takes an injected fetch; nothing here stores anything.
//
// Documentation read for this library: https://docs.bsky.app/docs/advanced-guides/posts ,
// /post-richtext , /rate-limits ; https://atproto.com/specs/oauth , /xrpc , /tid ;
// the com.atproto.* and app.bsky.* lexicons at https://github.com/bluesky-social/atproto ;
// RFC 9449 (DPoP), RFC 9126 (PAR), RFC 7009 (revocation), RFC 8414 and RFC 9728 (metadata).

export { createBlueskyClient } from './client.ts';
export type { BlueskyClient, BlueskyClientConfig, CreatePostOptions, FindOptions } from './client.ts';

export { createSession, refreshSession, deleteSession, decodeJwt, passwordKindOf, pdsFromDidDoc } from './session.ts';
export type { CreateSessionInput, SessionResult } from './session.ts';

export { resolveHandle, resolveIdentity, fetchDidDocument, PLC_DIRECTORY } from './identity.ts';
export type { DidDocument, ResolvedIdentity } from './identity.ts';

export { buildFacets, detectMentions, detectLinks, detectTags, normalizeFacets, sliceBytes, graphemeLength, utf8Length, looksLikeHandle } from './richtext.ts';
export type { FacetBuild, MentionSpan, LinkSpan, TagSpan } from './richtext.ts';

export { checkPostDraft, checkFacets, buildPostRecord, parsePostValue, parseAtUri, webUrlFor, LIMITS } from './post.ts';
export type { ParsedAtUri } from './post.ts';

export { uploadVideoViaService, VIDEO_SERVICE } from './video.ts';
export { newTid, tidFromKey, encodeTid, isTid } from './tid.ts';
export { publishThread } from './thread.ts';
export type { ThreadItem, ThreadPosted, ThreadOutcome, ThreadPoster } from './thread.ts';

export { buildClientMetadata, discoverOAuth, startOAuth, completeOAuth, refreshOAuth, revokeOAuth, parseCallback, DEFAULT_SCOPE } from './oauth.ts';
export type { OAuthClientConfig, ClientAuth, AuthServerMetadata, PendingOAuth, StartOAuthInput, OAuthCallback } from './oauth.ts';
export { generateClientKey, generateKeyPair, createDpopProof } from './dpop.ts';
export type { ClientKey } from './dpop.ts';

export { classifyResponse, classifyThrown, parseInstant, parseRateLimit, validationError } from './errors.ts';
export type { Result, Ok, Err, NetworkError, ErrorKind, RateLimitInfo, Problem } from './errors.ts';
export type { FetchFn } from './http.ts';
export type {
  StrongRef,
  BlobRef,
  AspectRatio,
  Facet,
  FacetFeature,
  ImageDraft,
  VideoDraft,
  ExternalDraft,
  PostDraft,
  PostRecord,
  CreatedPost,
  PostReadBack,
  BlueskyProfile,
  PasswordKind,
  PasswordAuth,
  OAuthAuth,
  BlueskyAuth,
  DpopKeyPair,
  AuthServerRef,
} from './types.ts';
