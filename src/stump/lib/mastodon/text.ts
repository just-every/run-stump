// Length counting and draft checks against the instance's own limits.
//
// Sources:
//   Limits come from GET /api/v2/instance: https://docs.joinmastodon.org/methods/instance/
//   URLs always count for 23 characters: https://docs.joinmastodon.org/api/guidelines/
//   Counting rule (graphemes; content warning counts; a URL is its reserved weight;
//   a remote mention counts as @user): Mastodon's StatusLengthValidator,
//   https://github.com/mastodon/mastodon/blob/main/app/validators/status_length_validator.rb
//   Mention pattern: Account::MENTION_RE in
//   https://github.com/mastodon/mastodon/blob/main/app/models/account.rb
//   Poll rules: https://docs.joinmastodon.org/methods/statuses/ (poll and media_ids exclude each other)

import type { InstanceInfo } from './instance.ts';
import type { Problem } from './errors.ts';
import type { StatusDraft, StatusDraftOptions } from './types.ts';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function graphemeLength(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

const URL_RE = /https?:\/\/[^\s<>]+/giu;
const MENTION_RE = /(?<![=/\p{L}\p{N}_])@([a-z0-9_]+(?:[.-]+[a-z0-9_]+)*)(?:@[\p{L}\p{N}_]+(?:[.-]+[\p{L}\p{N}_]+)*)?/giu;

/** Trailing punctuation that ends a sentence rather than a URL. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1];
    if (last === undefined) return url;
    if (/[.,;:!?'"’”*_~]/.test(last)) url = url.slice(0, -1);
    else if (last === ')' && !url.includes('(')) url = url.slice(0, -1);
    else if (last === ']' && !url.includes('[')) url = url.slice(0, -1);
    else return url;
  }
}

/** The text as the instance counts it: URLs and mentions replaced by what they cost. */
export function countableText(text: string, charsReservedPerUrl: number): string {
  const withUrls = text.replace(URL_RE, (m) => {
    const url = trimUrl(m);
    return 'x'.repeat(charsReservedPerUrl) + m.slice(url.length);
  });
  return withUrls.replace(MENTION_RE, (_m, user: string) => `@${user}`);
}

/** Length of a status as the instance counts it against max_characters. */
export function statusLength(draft: { text: string; spoilerText?: string }, charsReservedPerUrl = 23): number {
  return graphemeLength((draft.spoilerText ?? '') + countableText(draft.text, charsReservedPerUrl));
}

/**
 * Checks a draft against the instance's reported limits before anything is sent.
 * A limit the instance did not report is not checked here; the instance stays the authority.
 */
export function checkStatusDraft(draft: StatusDraft, info: InstanceInfo, options: StatusDraftOptions = {}): Problem[] {
  const problems: Problem[] = [];
  const requireAlt = options.requireAltText ?? true;
  const mediaCount = draft.mediaIds?.length ?? 0;

  if (draft.text.trim() === '' && mediaCount === 0 && !draft.poll) {
    problems.push({ code: 'empty', message: 'A status needs text, media or a poll', path: 'text' });
  }
  const length = statusLength(draft, info.charsReservedPerUrl);
  if (length > info.maxCharacters) {
    problems.push({
      code: 'text_too_long',
      message: `${length} characters; ${info.domain} allows ${info.maxCharacters}`,
      path: 'text',
    });
  }
  if (draft.visibility !== undefined && !['public', 'unlisted', 'private'].includes(draft.visibility)) {
    problems.push({ code: 'visibility_invalid', message: `Visibility "${String(draft.visibility)}" is not public, unlisted or private`, path: 'visibility' });
  }
  if (draft.poll && mediaCount > 0) {
    problems.push({ code: 'poll_with_media', message: 'A status cannot carry both a poll and media', path: 'poll' });
  }
  if (info.maxMediaAttachments !== null && mediaCount > info.maxMediaAttachments) {
    problems.push({ code: 'too_many_media', message: `${mediaCount} media; ${info.domain} allows ${info.maxMediaAttachments}`, path: 'mediaIds' });
  }
  if (draft.mediaIds && draft.mediaDescriptions) {
    draft.mediaIds.forEach((_id, i) => {
      const alt = draft.mediaDescriptions?.[i];
      const text = alt?.trim() ?? '';
      if (requireAlt && text === '') {
        problems.push({ code: 'alt_text_missing', message: `Media ${i + 1} has no alt text`, path: `media[${i}].description` });
      }
      const limit = info.media.descriptionLimit;
      if (limit !== null && alt && graphemeLength(alt) > limit) {
        problems.push({ code: 'alt_text_too_long', message: `Alt text of media ${i + 1} is over ${limit} characters`, path: `media[${i}].description` });
      }
    });
  }
  if (draft.poll) problems.push(...checkPoll(draft.poll, info));
  return problems;
}

export function checkPoll(poll: NonNullable<StatusDraft['poll']>, info: InstanceInfo): Problem[] {
  const problems: Problem[] = [];
  const limits = info.polls;
  if (poll.options.length < 2) problems.push({ code: 'poll_options_too_few', message: 'A poll needs at least two options', path: 'poll.options' });
  if (limits?.maxOptions != null && poll.options.length > limits.maxOptions) {
    problems.push({ code: 'poll_options_too_many', message: `${poll.options.length} options; ${info.domain} allows ${limits.maxOptions}`, path: 'poll.options' });
  }
  if (new Set(poll.options.map((o) => o.trim())).size !== poll.options.length) {
    problems.push({ code: 'poll_options_duplicate', message: 'Poll options must differ', path: 'poll.options' });
  }
  poll.options.forEach((o, i) => {
    if (o.trim() === '') problems.push({ code: 'poll_option_empty', message: `Poll option ${i + 1} is empty`, path: `poll.options[${i}]` });
    const max = limits?.maxCharactersPerOption;
    if (max != null && graphemeLength(o) > max) {
      problems.push({ code: 'poll_option_too_long', message: `Poll option ${i + 1} is over ${max} characters`, path: `poll.options[${i}]` });
    }
  });
  const secs = poll.expiresInSeconds;
  if (!Number.isInteger(secs) || secs <= 0) {
    problems.push({ code: 'poll_expiry_invalid', message: 'A poll closes after a whole number of seconds', path: 'poll.expiresInSeconds' });
  } else {
    if (limits?.minExpirationSeconds != null && secs < limits.minExpirationSeconds) {
      problems.push({ code: 'poll_expiry_too_short', message: `A poll must stay open at least ${limits.minExpirationSeconds} seconds on ${info.domain}`, path: 'poll.expiresInSeconds' });
    }
    if (limits?.maxExpirationSeconds != null && secs > limits.maxExpirationSeconds) {
      problems.push({ code: 'poll_expiry_too_long', message: `A poll can stay open at most ${limits.maxExpirationSeconds} seconds on ${info.domain}`, path: 'poll.expiresInSeconds' });
    }
  }
  return problems;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Mastodon content is HTML: paragraphs and line breaks become newlines, tags drop, entities decode. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}
