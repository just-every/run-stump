// Instance addressing, the instance's own limits and rules, and the bot-flag rule check.
//
// Sources:
//   GET /api/v2/instance (configuration.statuses, media_attachments, polls, rules):
//     https://docs.joinmastodon.org/methods/instance/
//   v1 shape used when v2 is absent (instances before 4.0):
//     https://docs.joinmastodon.org/methods/instance/ (GET /api/v1/instance)
//   URLs count as 23 characters: https://docs.joinmastodon.org/api/guidelines/
//   Account.bot: https://docs.joinmastodon.org/entities/Account/

import { fail, invalidResponse, ok, type Result } from './errors.ts';
import { send, type HttpDeps } from './http.ts';

export interface InstanceRule {
  id: string;
  text: string;
}

export interface InstanceInfo {
  /** Origin that every call uses, for example https://mastodon.example. */
  origin: string;
  domain: string;
  title: string;
  version: string;
  /** The instance's own post length, counted by statusLength. */
  maxCharacters: number;
  /** Characters every URL costs. Mastodon documents 23. */
  charsReservedPerUrl: number;
  /** null means the instance did not report the value, so no local check is made. */
  maxMediaAttachments: number | null;
  media: {
    descriptionLimit: number | null;
    imageSizeLimit: number | null;
    videoSizeLimit: number | null;
    supportedMimeTypes: string[] | null;
  };
  polls: {
    maxOptions: number | null;
    maxCharactersPerOption: number | null;
    minExpirationSeconds: number | null;
    maxExpirationSeconds: number | null;
  } | null;
  rules: InstanceRule[];
  /** Rules whose text asks automated accounts to carry the bot flag. */
  botFlagRules: InstanceRule[];
  source: 'v2' | 'v1';
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Accepts a bare host ("mastodon.social"), an origin or any URL on the instance,
 * and returns the origin. https only, except for a loopback host (a local instance).
 */
export function normalizeInstance(input: string): { ok: true; origin: string; host: string } | { ok: false; message: string } {
  const raw = input.trim();
  if (raw === '') return { ok: false, message: 'Instance address is empty' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, message: `"${raw}" is not an instance address` };
  }
  if (url.username || url.password) return { ok: false, message: 'Instance address must not carry credentials' };
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    return { ok: false, message: 'Instance address must use https' };
  }
  if (!loopback && !url.hostname.includes('.')) return { ok: false, message: `"${url.hostname}" is not a public host name` };
  if (!loopback && url.port !== '') return { ok: false, message: 'Instance address must not name a port' };
  return { ok: true, origin: url.origin, host: url.host };
}

const BOT_WORD = /\b(bots?|automated|automation|robots?|auto-?posting|non-?human)\b/i;
const ASKS_FLAG = /\b(mark(ed)?|flag(ged)?|label(l?ed)?|tag(ged)?|identif(y|ied)|declare[ds]?|disclose[ds]?|set|must|require[ds]?|need|should|have to|has to|clearly)\b/i;

/**
 * Mastodon rules are free text. A rule asks for the bot flag when it speaks of
 * bots or automated accounts and asks for them to be marked, labelled or disclosed.
 * The matching rules are returned so a refusal can name them. A person can still
 * override the result where a rule is read differently.
 */
export function rulesRequiringBotFlag(rules: InstanceRule[]): InstanceRule[] {
  return rules.filter((r) => BOT_WORD.test(r.text) && ASKS_FLAG.test(r.text));
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseRules(v: unknown): InstanceRule[] {
  if (!Array.isArray(v)) return [];
  const rules: InstanceRule[] = [];
  for (const r of v) {
    const o = obj(r);
    const text = str(o?.text);
    if (o && text !== undefined) rules.push({ id: String(o.id ?? rules.length + 1), text });
  }
  return rules;
}

/** Normalizes a v2 (or v1) instance document. Returns null when max_characters is absent. */
export function parseInstance(origin: string, json: unknown, source: 'v2' | 'v1'): InstanceInfo | null {
  const doc = obj(json);
  if (!doc) return null;
  const config = obj(doc.configuration);
  const statuses = obj(config?.statuses);
  const maxCharacters = int(statuses?.max_characters) ?? int(doc.max_toot_chars);
  if (maxCharacters === null) return null;
  const media = obj(config?.media_attachments);
  const polls = obj(config?.polls);
  const mimes = Array.isArray(media?.supported_mime_types) ? (media.supported_mime_types as unknown[]).filter((m): m is string => typeof m === 'string') : null;
  const rules = parseRules(doc.rules);
  const domain = str(doc.domain) ?? str(doc.uri) ?? new URL(origin).host;
  return {
    origin,
    domain,
    title: str(doc.title) ?? domain,
    version: str(doc.version) ?? '',
    maxCharacters,
    charsReservedPerUrl: int(statuses?.characters_reserved_per_url) ?? 23,
    maxMediaAttachments: int(statuses?.max_media_attachments),
    media: {
      descriptionLimit: int(media?.description_limit),
      imageSizeLimit: int(media?.image_size_limit),
      videoSizeLimit: int(media?.video_size_limit),
      supportedMimeTypes: mimes,
    },
    polls: polls
      ? {
          maxOptions: int(polls.max_options),
          maxCharactersPerOption: int(polls.max_characters_per_option),
          minExpirationSeconds: int(polls.min_expiration),
          maxExpirationSeconds: int(polls.max_expiration),
        }
      : null,
    rules,
    botFlagRules: rulesRequiringBotFlag(rules),
    source,
  };
}

/** Reads the instance's limits and rules: v2 first, v1 when the instance predates v2. */
export async function getInstanceInfo(deps: HttpDeps, origin: string): Promise<Result<InstanceInfo>> {
  const v2 = await send(deps, { method: 'GET', url: `${origin}/api/v2/instance`, write: false, headers: { accept: 'application/json' } });
  let source: 'v2' | 'v1' = 'v2';
  let doc: unknown;
  if (v2.ok) {
    doc = v2.value.json;
  } else if (v2.error.kind === 'not_found') {
    const v1 = await send(deps, { method: 'GET', url: `${origin}/api/v1/instance`, write: false, headers: { accept: 'application/json' } });
    if (!v1.ok) return fail(v1.error);
    source = 'v1';
    doc = v1.value.json;
  } else {
    return fail(v2.error);
  }
  const info = parseInstance(origin, doc, source);
  if (!info) return invalidResponse(`${origin} did not report configuration.statuses.max_characters, so its post limit is unknown`);
  // Rules sit on a separate v1 endpoint on instances whose instance document lacks them.
  if (info.rules.length === 0 && source === 'v1') {
    const rules = await send(deps, { method: 'GET', url: `${origin}/api/v1/instance/rules`, write: false, headers: { accept: 'application/json' } });
    if (rules.ok) {
      info.rules = parseRules(rules.value.json);
      info.botFlagRules = rulesRequiringBotFlag(info.rules);
    }
  }
  return ok(info);
}
