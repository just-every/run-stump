// Draft and read-back shapes for Mastodon statuses.
// Entity fields: https://docs.joinmastodon.org/entities/Status/ and https://docs.joinmastodon.org/methods/statuses/

export type Visibility = 'public' | 'unlisted' | 'private';

export interface PollDraft {
  options: string[];
  /** Seconds until the poll closes. */
  expiresInSeconds: number;
  multiple?: boolean;
  hideTotals?: boolean;
}

export interface MediaFile {
  bytes: Uint8Array | ArrayBuffer | Blob;
  mimeType: string;
  filename?: string;
  /** Alt text. Required by default; see StatusDraftOptions.requireAltText. */
  description?: string;
  /** Focal point, x and y each from -1 to 1. */
  focus?: { x: number; y: number };
}

export interface UploadedMedia {
  id: string;
  type: string;
  url: string | null;
  previewUrl: string | null;
  description: string | null;
}

export interface StatusDraft {
  text: string;
  /** Content warning. Counts toward the length limit. */
  spoilerText?: string;
  visibility?: Visibility;
  /** Ids from uploadMedia. Cannot be combined with a poll. */
  mediaIds?: string[];
  /** Alt text of the media in mediaIds, in the same order, for the draft check. */
  mediaDescriptions?: Array<string | null | undefined>;
  poll?: PollDraft;
  inReplyToId?: string;
  language?: string;
  sensitive?: boolean;
}

export interface StatusDraftOptions {
  /** Refuse media without alt text. Default true. */
  requireAltText?: boolean;
}

export interface PostedPoll {
  id: string;
  expiresAt: string | null;
  expired: boolean;
  multiple: boolean;
  options: Array<{ title: string; votesCount: number | null }>;
}

export interface PostedStatus {
  id: string;
  /** ActivityPub id. */
  uri: string;
  /** Web address people open. Falls back to uri when the instance sends none. */
  url: string;
  createdAt: string;
  visibility: string;
  spoilerText: string;
  sensitive: boolean;
  inReplyToId: string | null;
  language: string | null;
  contentHtml: string;
  media: Array<{ id: string; type: string; url: string | null; description: string | null }>;
  poll: PostedPoll | null;
  accountId: string | null;
  /** The posting account's followers_count, as the instance answers it with the status. */
  accountFollowers: number | null;
}

export interface StatusReadBack extends PostedStatus {
  /** The exact text as posted, from GET /api/v1/statuses/:id/source. Null if the instance has no source endpoint. */
  sourceText: string | null;
  /** The content with markup removed, for display and a rough comparison. */
  plainText: string;
}
