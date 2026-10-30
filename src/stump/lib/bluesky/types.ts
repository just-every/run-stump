// Record, session and auth shapes for Bluesky (atproto).
// Lexicons: https://github.com/bluesky-social/atproto/tree/main/lexicons and
// https://github.com/bluesky-social/atproto/tree/main/packages/api/lexicons/app/bsky
// (feed/post.json, richtext/facet.json, embed/images.json, embed/video.json, embed/external.json,
//  embed/record.json, embed/recordWithMedia.json).

export interface StrongRef {
  uri: string;
  cid: string;
}

export interface BlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export interface AspectRatio {
  width: number;
  height: number;
}

export interface ByteSlice {
  byteStart: number;
  byteEnd: number;
}

export type FacetFeature =
  | { $type: 'app.bsky.richtext.facet#mention'; did: string }
  | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  | { $type: 'app.bsky.richtext.facet#tag'; tag: string };

export interface Facet {
  index: ByteSlice;
  features: FacetFeature[];
}

export interface ImageDraft {
  blob: BlobRef;
  /** Alt text. A post with an image that has none cannot be marked ready. */
  alt: string;
  aspectRatio?: AspectRatio;
}

export interface VideoDraft {
  blob: BlobRef;
  alt: string;
  aspectRatio?: AspectRatio;
  captions?: Array<{ lang: string; file: BlobRef }>;
}

export interface ExternalDraft {
  uri: string;
  title: string;
  description: string;
  thumb?: BlobRef;
}

export interface PostDraft {
  text: string;
  /** Prepared facets. When absent, facets are detected from the text (see buildFacets). */
  facets?: Facet[];
  langs?: string[];
  /** Hashtags beyond those in the text (record.tags), without the leading #. */
  tags?: string[];
  /** Reply refs. root is the first post of the thread, parent the post replied to. */
  reply?: { root: StrongRef; parent: StrongRef };
  images?: ImageDraft[];
  video?: VideoDraft;
  /** A link card. */
  external?: ExternalDraft;
  /** A quote post. May sit beside images, a video or a link card. */
  quote?: StrongRef;
  /** ISO 8601 UTC. Default: now. */
  createdAt?: string;
}

export interface PostRecord {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  facets?: Facet[];
  langs?: string[];
  tags?: string[];
  reply?: { root: StrongRef; parent: StrongRef };
  embed?: Record<string, unknown>;
}

export interface CreatedPost {
  uri: string;
  cid: string;
  /** Record key, the last part of the at:// URI. */
  rkey: string;
  repo: string;
  /** Address people open: https://bsky.app/profile/<handle or did>/post/<rkey>. */
  webUrl: string;
  /** What was sent. */
  record: PostRecord;
  /**
   * True when the post was found under its record key after the create was refused as a duplicate or its
   * answer was lost, so it was read back instead of created again.
   */
  recoveredByKey: boolean;
}

export interface PostReadBack {
  uri: string;
  cid: string;
  rkey: string;
  repo: string;
  webUrl: string;
  /** The record exactly as the PDS holds it. */
  value: Record<string, unknown>;
  /** The record's text. */
  text: string;
  createdAt: string | null;
  facets: Facet[];
  reply: { root: StrongRef; parent: StrongRef } | null;
  /** alt text of images or video, in order. */
  altTexts: string[];
  embedType: string | null;
}

export interface BlueskyProfile {
  did: string;
  handle: string;
  displayName: string;
  description: string;
  avatar: BlobRef | null;
  /** False when the account has no profile record yet. */
  hasProfileRecord: boolean;
}

export type PasswordKind = 'app' | 'app_privileged' | 'main' | 'unknown';

/** A session made from an app password. */
export interface PasswordAuth {
  kind: 'password';
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
  accessExpiresAtMs: number | null;
  refreshExpiresAtMs: number | null;
  passwordKind: PasswordKind;
}

export interface DpopKeyPair {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}

export interface AuthServerRef {
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
}

/** A session made through atproto OAuth: DPoP-bound tokens. */
export interface OAuthAuth {
  kind: 'oauth';
  did: string;
  handle: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number | null;
  scope: string;
  dpopKey: DpopKeyPair;
  authServer: AuthServerRef;
  /** Latest DPoP-Nonce seen from the authorization server and from the PDS. */
  nonces: { authServer: string | null; pds: string | null };
}

export type BlueskyAuth = PasswordAuth | OAuthAuth;
