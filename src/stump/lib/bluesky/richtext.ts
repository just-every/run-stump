// Counting and rich-text facets at UTF-8 byte offsets.
//
// Sources:
//   Facets, byte offsets, link/mention/tag features: https://docs.bsky.app/docs/advanced-guides/post-richtext
//   Mentions, links and handle resolution in a post: https://docs.bsky.app/docs/advanced-guides/posts
//   Detection patterns: @atproto/api rich-text util.ts and detection.ts,
//     https://github.com/bluesky-social/atproto/blob/main/packages/api/src/rich-text/util.ts
//   Facet lexicon: https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/richtext/facet.json
//   Limits (300 graphemes, 3000 bytes; tags 64 graphemes): app/bsky/feed/post.json lexicon.

import type { Facet } from './types.ts';

const encoder = new TextEncoder();
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function utf8Length(s: string): number {
  return encoder.encode(s).byteLength;
}

export function graphemeLength(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

/** UTF-16 index to UTF-8 byte offset. */
export function utf16ToByteOffset(text: string, index: number): number {
  return encoder.encode(text.slice(0, index)).byteLength;
}

/** The text between two byte offsets, or null when an offset falls inside a character. */
export function sliceBytes(text: string, byteStart: number, byteEnd: number): string | null {
  const bytes = encoder.encode(text);
  if (byteStart < 0 || byteEnd > bytes.byteLength || byteStart >= byteEnd) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(byteStart, byteEnd));
  } catch {
    return null;
  }
}

const MENTION_RE = /(^|\s|\()(@)([a-zA-Z0-9.-]+)(\b)/g;
const URL_RE = /(^|\s|\()(https?:\/\/[\S]+)/gi;
const TAG_RE =
  // eslint-disable-next-line no-misleading-character-class
  /(^|\s)[#＃]((?!️)[^\s­⁠ ​‌‍⃢]*[^\d\s\p{P}­⁠ ​‌‍⃢]+[^\s­⁠ ​‌‍⃢]*)?/gu;
const TRAILING_PUNCT_RE = /\p{P}+$/u;

export interface MentionSpan {
  handle: string;
  byteStart: number;
  byteEnd: number;
}
export interface LinkSpan {
  uri: string;
  byteStart: number;
  byteEnd: number;
}
export interface TagSpan {
  tag: string;
  byteStart: number;
  byteEnd: number;
}

/** A handle is two or more DNS labels whose last label does not start with a digit. */
export function looksLikeHandle(h: string): boolean {
  if (h.length > 253) return false;
  const labels = h.split('.');
  if (labels.length < 2) return false;
  return labels.every((l, i) => /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(l) && (i < labels.length - 1 || /^[a-zA-Z]/.test(l)));
}

export function detectMentions(text: string): MentionSpan[] {
  const out: MentionSpan[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const handle = m[3]!;
    if (!looksLikeHandle(handle)) continue;
    const start = m.index! + m[1]!.length;
    out.push({ handle, byteStart: utf16ToByteOffset(text, start), byteEnd: utf16ToByteOffset(text, start + 1 + handle.length) });
  }
  return out;
}

export function detectLinks(text: string): LinkSpan[] {
  const out: LinkSpan[] = [];
  for (const m of text.matchAll(URL_RE)) {
    let uri = m[2]!;
    const start = m.index! + m[1]!.length;
    let end = start + uri.length;
    for (;;) {
      if (/[.,;:!?]$/.test(uri)) {
        uri = uri.slice(0, -1);
        end--;
      } else if (/\)$/.test(uri) && !uri.includes('(')) {
        uri = uri.slice(0, -1);
        end--;
      } else break;
    }
    // Needs something after the scheme.
    if (!/^https?:\/\/[^/?#\s]+/i.test(uri)) continue;
    out.push({ uri, byteStart: utf16ToByteOffset(text, start), byteEnd: utf16ToByteOffset(text, end) });
  }
  return out;
}

export function detectTags(text: string): TagSpan[] {
  const out: TagSpan[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const leading = m[1]!;
    let tag = m[2];
    if (!tag) continue;
    tag = tag.trim().replace(TRAILING_PUNCT_RE, '');
    if (tag.length === 0 || graphemeLength(tag) > 64) continue;
    const start = m.index! + leading.length;
    out.push({ tag, byteStart: utf16ToByteOffset(text, start), byteEnd: utf16ToByteOffset(text, start + 1 + tag.length) });
  }
  return out;
}

/** Orders by start and drops any facet that overlaps one already kept. */
export function normalizeFacets(facets: Facet[]): Facet[] {
  const sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart || a.index.byteEnd - b.index.byteEnd);
  const kept: Facet[] = [];
  let end = -1;
  for (const f of sorted) {
    if (f.index.byteStart < end) continue;
    kept.push(f);
    end = f.index.byteEnd;
  }
  return kept;
}

export interface FacetBuild {
  facets: Facet[];
  /** Mentions whose handle did not resolve to an account. They stay plain text. */
  unresolvedMentions: string[];
}

/**
 * Builds the facets for a post's text: links, hashtags, and mentions resolved to DIDs through
 * resolveHandle (null = the handle does not exist). Handles are resolved once each.
 */
export async function buildFacets(text: string, resolveHandle: (handle: string) => Promise<string | null>): Promise<FacetBuild> {
  const facets: Facet[] = [];
  const unresolvedMentions: string[] = [];
  const cache = new Map<string, string | null>();
  for (const m of detectMentions(text)) {
    const key = m.handle.toLowerCase();
    if (!cache.has(key)) cache.set(key, await resolveHandle(key));
    const did = cache.get(key) ?? null;
    if (did === null) {
      if (!unresolvedMentions.includes(m.handle)) unresolvedMentions.push(m.handle);
      continue;
    }
    facets.push({ index: { byteStart: m.byteStart, byteEnd: m.byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#mention', did }] });
  }
  for (const l of detectLinks(text)) {
    facets.push({ index: { byteStart: l.byteStart, byteEnd: l.byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: l.uri }] });
  }
  for (const t of detectTags(text)) {
    facets.push({ index: { byteStart: t.byteStart, byteEnd: t.byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: t.tag }] });
  }
  return { facets: normalizeFacets(facets), unresolvedMentions };
}
