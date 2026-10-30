// Checks a post draft, builds the app.bsky.feed.post record, and reads a stored record back.
//
// Sources:
//   Record structure, replies, quote posts, images, link cards, facets:
//     https://docs.bsky.app/docs/advanced-guides/posts
//   Limits and shapes: the lexicons app/bsky/feed/post.json (text maxLength 3000, maxGraphemes 300,
//     langs max 3, tags max 8 of 64 graphemes), embed/images.json (4 images, 2,000,000 bytes each,
//     alt required), embed/video.json (video/mp4, 300,000,000 bytes, captions), embed/external.json
//     (uri, title, description required; thumb 1,000,000 bytes), embed/record.json,
//     embed/recordWithMedia.json — https://github.com/bluesky-social/atproto/tree/main/packages/api/lexicons/app/bsky
//   Post length 300 graphemes: https://docs.bsky.app/docs/advanced-guides/rate-limits (network table in docs/networks.md)

import type { Problem } from './errors.ts';
import { graphemeLength, sliceBytes, utf8Length } from './richtext.ts';
import type { BlobRef, Facet, PostDraft, PostReadBack, PostRecord, StrongRef } from './types.ts';

export const LIMITS = {
  maxGraphemes: 300,
  maxBytes: 3000,
  maxImages: 4,
  maxImageBytes: 2_000_000,
  maxVideoBytes: 300_000_000,
  maxThumbBytes: 1_000_000,
  maxLangs: 3,
  maxTags: 8,
  maxTagGraphemes: 64,
  maxCaptions: 20,
  maxCaptionBytes: 20_000,
} as const;

const AT_URI_RE = /^at:\/\/(did:[a-z]+:[a-zA-Z0-9._:%-]+|[a-zA-Z0-9.-]+)\/([a-zA-Z][a-zA-Z0-9.-]*)\/([A-Za-z0-9._:~-]{1,512})$/;
const CID_RE = /^[a-z2-7]{20,}$|^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

export interface ParsedAtUri {
  repo: string;
  collection: string;
  rkey: string;
}

export function parseAtUri(uri: string): ParsedAtUri | null {
  const m = AT_URI_RE.exec(uri);
  return m ? { repo: m[1]!, collection: m[2]!, rkey: m[3]! } : null;
}

function checkRef(ref: StrongRef | undefined, path: string, problems: Problem[]): void {
  if (!ref) return;
  if (parseAtUri(ref.uri) === null) problems.push({ code: 'ref_uri_invalid', message: `${path}.uri is not an at:// record address`, path: `${path}.uri` });
  if (!CID_RE.test(ref.cid)) problems.push({ code: 'ref_cid_invalid', message: `${path}.cid is not a CID`, path: `${path}.cid` });
}

function checkBlob(blob: BlobRef, accept: (mime: string) => boolean, maxSize: number, path: string, label: string, problems: Problem[]): void {
  if (blob.$type !== 'blob' || typeof blob.ref?.$link !== 'string') {
    problems.push({ code: 'blob_invalid', message: `${label} is not an uploaded blob`, path });
    return;
  }
  if (!accept(blob.mimeType)) problems.push({ code: 'blob_type_unsupported', message: `${label} is ${blob.mimeType}`, path: `${path}.mimeType` });
  if (blob.size > maxSize) problems.push({ code: 'blob_too_large', message: `${label} is ${blob.size} bytes; the limit is ${maxSize}`, path: `${path}.size` });
}

/** Problems that stop a draft being marked ready. Sends nothing. */
export function checkPostDraft(draft: PostDraft): Problem[] {
  const problems: Problem[] = [];
  const { text } = draft;
  const graphemes = graphemeLength(text);
  const bytes = utf8Length(text);
  if (graphemes > LIMITS.maxGraphemes) {
    problems.push({ code: 'text_too_long', message: `${graphemes} characters; Bluesky allows ${LIMITS.maxGraphemes}`, path: 'text' });
  }
  if (bytes > LIMITS.maxBytes) {
    problems.push({ code: 'text_too_many_bytes', message: `${bytes} bytes; Bluesky allows ${LIMITS.maxBytes}`, path: 'text' });
  }
  const embeds = [draft.images?.length ? 'images' : '', draft.video ? 'video' : '', draft.external ? 'external' : ''].filter(Boolean);
  if (embeds.length > 1) {
    problems.push({ code: 'embeds_conflict', message: `A post carries images, a video or a link card, not ${embeds.join(' and ')}`, path: 'embed' });
  }
  if (text.trim() === '' && embeds.length === 0 && !draft.quote) {
    problems.push({ code: 'empty', message: 'A post needs text or an embed', path: 'text' });
  }
  if (draft.images) {
    if (draft.images.length > LIMITS.maxImages) {
      problems.push({ code: 'too_many_images', message: `${draft.images.length} images; Bluesky allows ${LIMITS.maxImages}`, path: 'images' });
    }
    draft.images.forEach((img, i) => {
      if (img.alt.trim() === '') problems.push({ code: 'alt_text_missing', message: `Image ${i + 1} has no alt text`, path: `images[${i}].alt` });
      checkBlob(img.blob, (m) => m.startsWith('image/'), LIMITS.maxImageBytes, `images[${i}].blob`, `Image ${i + 1}`, problems);
      checkAspect(img.aspectRatio, `images[${i}].aspectRatio`, problems);
    });
  }
  if (draft.video) {
    if (draft.video.alt.trim() === '') problems.push({ code: 'alt_text_missing', message: 'The video has no alt text', path: 'video.alt' });
    checkBlob(draft.video.blob, (m) => m === 'video/mp4', LIMITS.maxVideoBytes, 'video.blob', 'The video', problems);
    checkAspect(draft.video.aspectRatio, 'video.aspectRatio', problems);
    if ((draft.video.captions?.length ?? 0) > LIMITS.maxCaptions) problems.push({ code: 'too_many_captions', message: `More than ${LIMITS.maxCaptions} caption files`, path: 'video.captions' });
    draft.video.captions?.forEach((c, i) => checkBlob(c.file, (m) => m === 'text/vtt', LIMITS.maxCaptionBytes, `video.captions[${i}].file`, `Caption ${i + 1}`, problems));
  }
  if (draft.external) {
    const e = draft.external;
    if (!/^https?:\/\//i.test(e.uri)) problems.push({ code: 'external_uri_invalid', message: 'A link card needs an http or https address', path: 'external.uri' });
    if (e.thumb) checkBlob(e.thumb, (m) => m.startsWith('image/'), LIMITS.maxThumbBytes, 'external.thumb', 'The link card image', problems);
  }
  checkRef(draft.quote, 'quote', problems);
  if (draft.reply) {
    checkRef(draft.reply.root, 'reply.root', problems);
    checkRef(draft.reply.parent, 'reply.parent', problems);
  }
  if (draft.langs && draft.langs.length > LIMITS.maxLangs) {
    problems.push({ code: 'too_many_langs', message: `${draft.langs.length} languages; Bluesky allows ${LIMITS.maxLangs}`, path: 'langs' });
  }
  if (draft.tags) {
    if (draft.tags.length > LIMITS.maxTags) problems.push({ code: 'too_many_tags', message: `${draft.tags.length} tags; Bluesky allows ${LIMITS.maxTags}`, path: 'tags' });
    draft.tags.forEach((t, i) => {
      if (t === '' || graphemeLength(t) > LIMITS.maxTagGraphemes) problems.push({ code: 'tag_invalid', message: `Tag ${i + 1} is empty or over ${LIMITS.maxTagGraphemes} characters`, path: `tags[${i}]` });
    });
  }
  if (draft.facets) problems.push(...checkFacets(text, draft.facets));
  return problems;
}

function checkAspect(a: { width: number; height: number } | undefined, path: string, problems: Problem[]): void {
  if (a && !(Number.isInteger(a.width) && Number.isInteger(a.height) && a.width > 0 && a.height > 0)) {
    problems.push({ code: 'aspect_ratio_invalid', message: 'Aspect ratio needs positive whole width and height', path });
  }
}

/** Facets must sit on character boundaries inside the text and must not overlap. */
export function checkFacets(text: string, facets: Facet[]): Problem[] {
  const problems: Problem[] = [];
  const total = utf8Length(text);
  let end = -1;
  [...facets]
    .sort((a, b) => a.index.byteStart - b.index.byteStart)
    .forEach((f, i) => {
      const { byteStart, byteEnd } = f.index;
      const path = `facets[${i}]`;
      if (!(Number.isInteger(byteStart) && Number.isInteger(byteEnd)) || byteStart < 0 || byteEnd > total || byteStart >= byteEnd) {
        problems.push({ code: 'facet_out_of_range', message: `Facet ${i + 1} runs ${byteStart}-${byteEnd} in a text of ${total} bytes`, path });
      } else if (sliceBytes(text, byteStart, byteEnd) === null) {
        problems.push({ code: 'facet_splits_character', message: `Facet ${i + 1} starts or ends inside a character`, path });
      }
      if (byteStart < end) problems.push({ code: 'facet_overlap', message: `Facet ${i + 1} overlaps the one before it`, path });
      end = Math.max(end, byteEnd);
      if (f.features.length === 0) problems.push({ code: 'facet_empty', message: `Facet ${i + 1} has no feature`, path });
    });
  return problems;
}

function mediaEmbed(draft: PostDraft): Record<string, unknown> | null {
  if (draft.images && draft.images.length > 0) {
    return {
      $type: 'app.bsky.embed.images',
      images: draft.images.map((i) => ({ alt: i.alt, image: i.blob, ...(i.aspectRatio ? { aspectRatio: i.aspectRatio } : {}) })),
    };
  }
  if (draft.video) {
    const v = draft.video;
    return {
      $type: 'app.bsky.embed.video',
      video: v.blob,
      alt: v.alt,
      ...(v.aspectRatio ? { aspectRatio: v.aspectRatio } : {}),
      ...(v.captions && v.captions.length > 0 ? { captions: v.captions } : {}),
    };
  }
  if (draft.external) {
    const e = draft.external;
    return {
      $type: 'app.bsky.embed.external',
      external: { uri: e.uri, title: e.title, description: e.description, ...(e.thumb ? { thumb: e.thumb } : {}) },
    };
  }
  return null;
}

export function buildPostRecord(draft: PostDraft, facets: Facet[] | undefined, createdAt: string): PostRecord {
  const record: PostRecord = { $type: 'app.bsky.feed.post', text: draft.text, createdAt };
  if (facets && facets.length > 0) record.facets = facets;
  if (draft.langs && draft.langs.length > 0) record.langs = draft.langs;
  if (draft.tags && draft.tags.length > 0) record.tags = draft.tags;
  if (draft.reply) record.reply = { root: { uri: draft.reply.root.uri, cid: draft.reply.root.cid }, parent: { uri: draft.reply.parent.uri, cid: draft.reply.parent.cid } };
  const media = mediaEmbed(draft);
  if (draft.quote) {
    const rec = { $type: 'app.bsky.embed.record', record: { uri: draft.quote.uri, cid: draft.quote.cid } };
    record.embed = media ? { $type: 'app.bsky.embed.recordWithMedia', record: rec, media } : rec;
  } else if (media) {
    record.embed = media;
  }
  return record;
}

/** The address people open for a post. Use the handle when known, else the DID. */
export function webUrlFor(repoOrHandle: string, rkey: string): string {
  return `https://bsky.app/profile/${repoOrHandle}/post/${rkey}`;
}

/** Reads the parts of a stored app.bsky.feed.post record that the ledger and delivery checks need. */
export function parsePostValue(value: unknown): Omit<PostReadBack, 'uri' | 'cid' | 'rkey' | 'repo' | 'webUrl' | 'value'> | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== 'string') return null;
  const embed = v.embed && typeof v.embed === 'object' ? (v.embed as Record<string, unknown>) : null;
  const altTexts: string[] = [];
  const collect = (e: Record<string, unknown> | null): void => {
    if (!e) return;
    if (Array.isArray(e.images)) for (const i of e.images as Array<Record<string, unknown>>) altTexts.push(typeof i?.alt === 'string' ? i.alt : '');
    if (e.$type === 'app.bsky.embed.video') altTexts.push(typeof e.alt === 'string' ? e.alt : '');
    if (e.media && typeof e.media === 'object') collect(e.media as Record<string, unknown>);
  };
  collect(embed);
  const reply = v.reply && typeof v.reply === 'object' ? (v.reply as { root?: StrongRef; parent?: StrongRef }) : null;
  return {
    text: v.text,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : null,
    facets: Array.isArray(v.facets) ? (v.facets as Facet[]) : [],
    reply: reply?.root && reply.parent ? { root: reply.root, parent: reply.parent } : null,
    altTexts,
    embedType: typeof embed?.$type === 'string' ? embed.$type : null,
  };
}
