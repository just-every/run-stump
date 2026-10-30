// Field-level normalisers shared by the Markdown and CSV venue-list readers.
import type { Json, JsonObject } from './types.ts';
import { foldName, isHttpUrl } from './url.ts';

export const VENUE_KINDS = ['subreddit', 'forum', 'slack', 'discord', 'newsletter', 'podcast', 'directory', 'publication', 'journalist', 'launch', 'event', 'own_channel'] as const;
export type VenueKind = (typeof VENUE_KINDS)[number];

export const VENUE_STATUSES = ['candidate', 'join_first', 'ready', 'editorial', 'paid', 'hold', 'excluded'] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];

/** Ranked so a venue takes the strongest priority among its entries. */
export const PRIORITY_RANK: Record<string, number> = { top: 5, high: 4, strong: 4, medium: 3, low: 1, fallback: 1 };

export function normalizeStatus(text: string): VenueStatus | null {
  const word = text.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (VENUE_STATUSES as readonly string[]).includes(word) ? (word as VenueStatus) : null;
}

export function normalizePriority(text: string): string | null {
  const word = text.trim().toLowerCase();
  return Object.hasOwn(PRIORITY_RANK, word) ? word : null;
}

export function strongestPriority(values: string[]): string | null {
  let best: string | null = null;
  for (const value of values) if (best === null || (PRIORITY_RANK[value] ?? 0) > (PRIORITY_RANK[best] ?? 0)) best = value;
  return best;
}

/** "true" or "false" (any case); an empty value means none (false). */
export function parseBool(text: string): boolean | null {
  const word = text.trim().toLowerCase();
  if (word === '') return false;
  if (word === 'true') return true;
  if (word === 'false') return false;
  return null;
}

/** An inline JSON array of strings; the empty value is the empty list. */
export function parseJsonStringList(text: string): string[] | null {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  try {
    const value: unknown = JSON.parse(trimmed);
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return null;
    return (value as string[]).map(item => item.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** A list cell in a CSV: an inline JSON array, or items separated by semicolons or line breaks. */
export function parseListCell(text: string): string[] | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) return parseJsonStringList(trimmed);
  return trimmed.split(/[;\n]/).map(item => item.trim()).filter(Boolean);
}

export function uniqueFolded(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = foldName(value);
    if (key && !seen.has(key)) { seen.add(key); out.push(value.trim()); }
  }
  return out;
}

export function checkUrlList(label: string, urls: string[], errors: string[]): void {
  for (const url of urls) if (!isHttpUrl(url)) errors.push(`${label} holds "${url}", which is not an http(s) URL`);
}

const LINK_CHECK_KEYS = ['status', 'http', 'note', 'current_thread_finder', 'final_url'];

/** "status: ok; http: 200; note: ..." into fields. A note may itself hold "; ". */
export function parseLinkCheck(text: string): JsonObject | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const out: JsonObject = {};
  let last: string | null = null;
  for (const part of trimmed.split('; ')) {
    const match = /^([a-z_]+): ?(.*)$/s.exec(part);
    if (match && LINK_CHECK_KEYS.includes(match[1]!)) {
      last = match[1]!;
      out[last] = match[2]!.trim();
    } else if (last) {
      out[last] = `${out[last] as string}; ${part}`;
    } else {
      out.status = part.trim();
      last = 'status';
    }
  }
  if (typeof out.http === 'string') {
    const code = Number(out.http);
    out.http = Number.isInteger(code) ? code : out.http;
  }
  return out;
}

const KIND_BY_PREFIX: Record<string, VenueKind> = {
  reddit: 'subreddit', slack: 'slack', discord: 'discord', newsletter: 'newsletter', forum: 'forum',
  directory: 'directory', editorial: 'publication', assoc: 'publication', article: 'publication',
  community: 'forum', x: 'forum', github: 'forum', gh: 'forum', mastodon: 'forum', lemmy: 'forum',
  podcast: 'podcast', journalist: 'journalist', launch: 'launch', event: 'event', own: 'own_channel',
};
const KIND_WORDS: [RegExp, VenueKind][] = [
  [/reddit/, 'subreddit'], [/discord/, 'discord'], [/slack/, 'slack'], [/newsletter/, 'newsletter'],
  [/podcast/, 'podcast'], [/journalist|reporter/, 'journalist'], [/directory|catalogue|catalog|listing/, 'directory'],
  [/publication|press|editorial|magazine|association|trade|news|sponsored|article|blog/, 'publication'],
  [/forum|discourse|xenforo|community|lemmy|mastodon|github|discussions/, 'forum'],
];
const KIND_HOSTS: [RegExp, VenueKind][] = [
  [/(^|\.)reddit\.com$/, 'subreddit'], [/(^|\.)slack\.com$/, 'slack'], [/(^|\.)discord\.(com|gg)$/, 'discord'],
  [/(^|\.)(x|twitter|github|lemmy\.[a-z]+|mastodon\.[a-z]+)\.com$|^lobste\.rs$/, 'forum'],
];

/** The venue kind: an explicit value, else the list's own id prefix, else platform and name words, else the URL host. */
export function inferKind(input: { explicit?: string; externalId?: string | null; platform?: string; name?: string; url?: string | null }): { kind: VenueKind; guessed: boolean } {
  const explicit = (input.explicit ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((VENUE_KINDS as readonly string[]).includes(explicit)) return { kind: explicit as VenueKind, guessed: false };
  const prefix = (input.externalId ?? '').split('-')[0]!.toLowerCase();
  if (Object.hasOwn(KIND_BY_PREFIX, prefix)) return { kind: KIND_BY_PREFIX[prefix]!, guessed: false };
  const words = `${input.platform ?? ''} ${input.name ?? ''}`.toLowerCase();
  for (const [pattern, kind] of KIND_WORDS) if (pattern.test(words)) return { kind, guessed: false };
  if (input.url) {
    try {
      const host = new URL(input.url).hostname.toLowerCase();
      for (const [pattern, kind] of KIND_HOSTS) if (pattern.test(host)) return { kind, guessed: false };
    } catch { /* not a URL: fall through */ }
  }
  return { kind: 'forum', guessed: true };
}

const COUNT_WORDS: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const PER_UNIT: Record<string, string> = { day: 'day', daily: 'day', week: 'week', weekly: 'week', month: 'month', monthly: 'month', quarter: 'quarter', quarterly: 'quarter', year: 'year', yearly: 'year' };

/**
 * The shared limit as the list wrote it, plus a count and period only when the
 * sentence plainly states one ("One comment per weekly thread", "One post a
 * week"). Anything else keeps the text alone.
 */
export function parseSharedLimit(text: string): JsonObject | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,3})\b[^.;,]*?\b(?:a|an|per|each|every)\s+(?:(daily|weekly|monthly|quarterly|yearly)\s+)?(day|week|month|quarter|year)?(?:\b|$)/i.exec(trimmed);
  let posts: number | null = null;
  let per: string | null = null;
  if (match) {
    const count = /^\d/.test(match[1]!) ? Number(match[1]) : COUNT_WORDS[match[1]!.toLowerCase()];
    const unit = (match[2] ?? match[3] ?? '').toLowerCase();
    if (count && count > 0 && PER_UNIT[unit]) { posts = count; per = PER_UNIT[unit]!; }
  }
  return { text: trimmed, posts, per };
}

export interface AiRuleInput { banned: boolean; rulesUrls: string[]; readAt: string | null; origin: string }

/** The AI-writing rule the list states: a venue that requires human-written posts bans AI text. */
export function aiTextRule(input: AiRuleInput): JsonObject | null {
  if (!input.banned) return null;
  const single = input.rulesUrls.length === 1 ? input.rulesUrls[0]! : null;
  return {
    value: 'banned',
    source_url: single,
    source_urls: input.rulesUrls,
    read_at: input.readAt,
    sourced: single !== null,
    origin: 'import',
    origin_detail: input.origin,
  };
}

export const str = (value: string | undefined): string | null => (value && value.trim() ? value.trim() : null);
export const jsonList = (items: string[]): Json[] => items.slice();
