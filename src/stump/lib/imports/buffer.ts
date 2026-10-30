// Reader for a Buffer export: a JSON bundle of the objects Buffer's published
// v1 REST API returns,
//   { format, profiles: [profile...], updates: { <profile_id>: { pending, sent } } }
// where `pending` and `sent` are each a list response ({ total, updates: [...] })
// or the bare list of update objects.
//
// Buffer API v1 reference (the pages below redirect to Buffer's current
// developer site, where v1 is documented as the legacy REST API):
//   https://buffer.com/developers/api/profiles   GET profiles.json, profile and schedules objects
//   https://buffer.com/developers/api/updates    GET profiles/:id/updates/pending.json and sent.json, the update object
//   https://buffer.com/developers/legacy-api     the legacy v1 endpoints and their replacement
//   https://developers.buffer.com/guides/rest-migration.html   the v1 endpoint list and quota errors
// Fields read: profile id, service, service_type, service_username,
// formatted_username, timezone, schedules[{days, times}]; update id, text,
// created_at, due_at, sent_at, status, draft, profile_id, service_update_id,
// service_link, via, media{link,title,description,picture,thumbnail,photo},
// statistics{...numbers}. Numeric times are Unix seconds. Buffer's v1 API
// carries no tokens or secrets, and none are read.
import type { ImportLimits, ImportRow, ImportWarning, Json, JsonObject, ParsedBuffer, RejectedRow } from './types.ts';
import { DEFAULT_LIMITS, ImportInputError } from './types.ts';
import { canonicalJson } from './canonical.ts';
import { isHttpUrl } from './url.ts';

export const BUFFER_BUNDLE_FORMAT = 'buffer-api-v1';

/** Buffer service name to Stump's network id. A service not listed here is rejected by name. */
export const BUFFER_NETWORKS: Record<string, string> = {
  twitter: 'x', x: 'x', linkedin: 'linkedin', facebook: 'facebook', instagram: 'instagram', threads: 'threads',
  bluesky: 'bluesky', mastodon: 'mastodon', youtube: 'youtube', tiktok: 'tiktok', pinterest: 'pinterest', googlebusiness: 'google_business',
};

/** Post length limits Stump knows exactly (docs/networks.md), in graphemes. */
const GRAPHEME_LIMITS: Record<string, number> = { bluesky: 300, threads: 500, linkedin: 3000 };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const channelTargetId = (profileId: string) => `buffer-channel:${profileId}`;
export const slotTargetId = (profileId: string, day: string, time: string) => `buffer-slot:${profileId}:${day}:${time}`;
export const sentTargetId = (updateId: string) => `buffer-sent:${updateId}`;
export const queuedTargetId = (updateId: string) => `buffer-queued:${updateId}`;
export const draftTargetId = (updateId: string) => `buffer-draft:${updateId}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const idOf = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() && v.length <= 200 && !/[\u0000-\u001f]/.test(v) ? v.trim() : null;
};
const textOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Unix seconds (or milliseconds) to an ISO 8601 UTC time; null when it is not a plausible time. */
export function unixToIso(v: unknown): string | null {
  const n = typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  const date = new Date(n > 1e11 ? n : n * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz.trim()) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() }); return tz.trim(); } catch { return null; }
}

function graphemeCount(text: string): number {
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (!Segmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) n++;
  return n;
}

const reject = (rejected: RejectedRow[], id: string, kind: string, reasons: string[]) => rejected.push({ id, kind, line: null, reason: reasons.join('; '), reasons });

export function parseBufferBundle(input: unknown, limits: Partial<ImportLimits> = {}): ParsedBuffer {
  const max = { ...DEFAULT_LIMITS, ...limits };
  let root: unknown = input;
  if (typeof input === 'string') {
    if (input.length > max.maxChars) throw new ImportInputError('input_too_large', `The Buffer export is ${input.length} characters; the limit is ${max.maxChars}.`);
    try { root = JSON.parse(input.replace(/^﻿/, '')); } catch { throw new ImportInputError('bad_json', 'The Buffer export is not valid JSON.'); }
  }
  if (!isObj(root)) throw new ImportInputError('bad_format', 'The Buffer export must be a JSON object with format, profiles and updates.');
  if (typeof root.format !== 'string' || !/^buffer/i.test(root.format)) throw new ImportInputError('bad_format', `The Buffer export's format must be "${BUFFER_BUNDLE_FORMAT}".`);
  if (!Array.isArray(root.profiles)) throw new ImportInputError('bad_format', 'The Buffer export has no "profiles" list.');
  const updatesRoot = root.updates === undefined || root.updates === null ? {} : root.updates;
  if (!isObj(updatesRoot)) throw new ImportInputError('bad_format', 'The Buffer export\'s "updates" must be an object keyed by profile id.');

  const rejected: RejectedRow[] = [];
  const warnings: ImportWarning[] = [];
  const channels: ImportRow[] = [];
  const slots: ImportRow[] = [];
  const sentRows: ImportRow[] = [];
  const queuedRows: ImportRow[] = [];
  const draftRows: ImportRow[] = [];
  let rowCount = 0;
  const count = (n = 1) => { rowCount += n; if (rowCount > max.maxRows) throw new ImportInputError('too_many_rows', `The Buffer export holds more than ${max.maxRows} rows.`); };

  const accepted = new Map<string, { network: string; targetId: string }>();
  const rejectedProfiles = new Map<string, string>();
  const seenProfiles = new Set<string>();

  root.profiles.forEach((profile, index) => {
    count();
    const errors: string[] = [];
    if (!isObj(profile)) { reject(rejected, `profiles[${index}]`, 'channel', ['the profile is not an object']); return; }
    const id = idOf(profile.id);
    if (!id) { reject(rejected, `profiles[${index}]`, 'channel', ['the profile has no id']); return; }
    if (seenProfiles.has(id)) { reject(rejected, id, 'channel', ['a profile with this id is already imported']); return; }
    seenProfiles.add(id);
    const service = typeof profile.service === 'string' ? profile.service.trim().toLowerCase() : '';
    const network = Object.hasOwn(BUFFER_NETWORKS, service) ? BUFFER_NETWORKS[service]! : null;
    if (!network) errors.push(service ? `the service "${service}" is not a network Stump posts to` : 'the profile has no service');
    const handle = textOf(profile.service_username) ?? textOf(profile.formatted_username);
    if (!handle) errors.push('the profile has no username');
    if (errors.length) { reject(rejected, id, 'channel', errors); rejectedProfiles.set(id, errors.join('; ')); return; }
    const timeZone = validTimeZone(profile.timezone);
    if (!timeZone) warnings.push({ code: 'channel_time_zone', message: `Profile ${id} has no usable time zone; its posting schedule is not imported.`, id });
    const targetId = channelTargetId(id);
    accepted.set(id, { network: network!, targetId });
    channels.push({
      kind: 'channel', sourceId: targetId,
      payload: {
        network: network!, handle: handle!, display_name: textOf(profile.formatted_username) ?? handle!,
        channel_type: textOf(profile.service_type), time_zone: timeZone,
        owner: { kind: 'company' }, state: 'awaiting_reconnect', import_ref: { source: 'buffer', profile_id: id },
      },
    });
    const schedules = profile.schedules;
    if (schedules === undefined || schedules === null) return;
    if (!Array.isArray(schedules)) { reject(rejected, `${id}/schedules`, 'slot', ['schedules is not a list']); return; }
    const seenSlots = new Set<string>();
    schedules.forEach((group, g) => {
      const label = `${id}/schedules[${g}]`;
      const days = isObj(group) && Array.isArray(group.days) ? group.days : null;
      const times = isObj(group) && Array.isArray(group.times) ? group.times : null;
      if (!days || !times) { reject(rejected, label, 'slot', ['a schedule needs days and times lists']); return; }
      const badDays = days.filter(d => typeof d !== 'string' || !DAYS.includes(d.trim().toLowerCase()));
      const normTimes = times.map(t => (typeof t === 'string' ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t.trim()) : null));
      const badTimes = times.filter((_, i) => !normTimes[i]);
      if (badDays.length || badTimes.length) {
        reject(rejected, label, 'slot', [...(badDays.length ? [`days ${JSON.stringify(badDays)} are not mon to sun`] : []), ...(badTimes.length ? [`times ${JSON.stringify(badTimes)} are not HH:MM`] : [])]);
        return;
      }
      if (!timeZone) { reject(rejected, label, 'slot', ['the channel has no usable time zone']); return; }
      for (const d of days as string[]) for (const m of normTimes) {
        const day = d.trim().toLowerCase();
        const time = `${m![1]!.padStart(2, '0')}:${m![2]}`;
        const slotId = slotTargetId(id, day, time);
        if (seenSlots.has(slotId)) continue;
        seenSlots.add(slotId);
        count();
        slots.push({ kind: 'slot', sourceId: slotId, payload: { channel_key: targetId, network: network!, day, time, time_zone: timeZone } });
      }
    });
  });

  for (const key of Object.keys(updatesRoot)) {
    if (!accepted.has(key) && !rejectedProfiles.has(key)) reject(rejected, key, 'post', ['updates are listed for a profile that is not in the export']);
  }

  const seenUpdates = new Map<string, { list: string; sig: string }>();
  const handleList = (profileId: string, which: 'sent' | 'pending') => {
    const bucket = (updatesRoot as Obj)[profileId];
    if (bucket === undefined || bucket === null) return;
    if (!isObj(bucket)) { reject(rejected, profileId, 'post', ['the profile\'s updates must hold pending and sent']); return; }
    const listValue = bucket[which];
    if (listValue === undefined || listValue === null) return;
    const where = `${profileId}/${which}`;
    let list: unknown[];
    if (Array.isArray(listValue)) list = listValue;
    else if (isObj(listValue) && Array.isArray(listValue.updates)) {
      list = listValue.updates;
      if (typeof listValue.total === 'number' && listValue.total > list.length) warnings.push({ code: 'incomplete_list', message: `${where} reports ${listValue.total} posts but holds ${list.length}; the export may be one page of several.`, id: where });
    } else { reject(rejected, where, 'post', ['expected a list of updates or a response with an "updates" list']); return; }
    const channel = accepted.get(profileId);
    for (const [index, update] of list.entries()) {
      count();
      const label = isObj(update) ? idOf(update.id) ?? `${where}[${index}]` : `${where}[${index}]`;
      if (!channel) { reject(rejected, label, which === 'sent' ? 'sent' : 'queued', [`its channel ${profileId} was rejected: ${rejectedProfiles.get(profileId) ?? 'unknown'}`]); continue; }
      const row = which === 'sent' ? sentRow(update, profileId, channel, where, index, rejected, warnings) : pendingRow(update, profileId, channel, where, index, rejected, warnings);
      if (!row) continue;
      const updateId = row.updateId;
      const sig = canonicalJson(row.row.payload as Json);
      const earlier = seenUpdates.get(updateId);
      if (earlier) {
        if (earlier.list === which && earlier.sig === sig) { warnings.push({ code: 'duplicate_update', message: `Update ${updateId} appears twice and is imported once.`, id: updateId }); continue; }
        reject(rejected, updateId, row.row.kind, [earlier.list === which ? 'another update with this id and different content is already imported' : `it is also listed as ${earlier.list === 'sent' ? 'sent' : 'pending'}`]);
        continue;
      }
      seenUpdates.set(updateId, { list: which, sig });
      (row.row.kind === 'sent' ? sentRows : row.row.kind === 'queued' ? queuedRows : draftRows).push(row.row);
    }
  };
  for (const key of Object.keys(updatesRoot)) handleList(key, 'sent');
  for (const key of Object.keys(updatesRoot)) handleList(key, 'pending');

  return {
    source: 'buffer',
    rows: [...channels, ...slots, ...sentRows, ...queuedRows, ...draftRows],
    rejected,
    warnings,
    summary: { channels: channels.length, sent: sentRows.length, queued: queuedRows.length },
  };
}

interface Built { row: ImportRow; updateId: string }

function commonUpdate(update: unknown, profileId: string, where: string, index: number, kind: string, rejected: RejectedRow[]): { u: Obj; id: string; text: string; media: JsonObject | null } | null {
  if (!isObj(update)) { reject(rejected, `${where}[${index}]`, kind, ['the update is not an object']); return null; }
  const id = idOf(update.id);
  if (!id) { reject(rejected, `${where}[${index}]`, kind, ['the update has no id']); return null; }
  const errors: string[] = [];
  const owner = idOf(update.profile_id);
  if (owner && owner !== profileId) errors.push(`it belongs to profile ${owner}, not ${profileId}`);
  const media = mediaOf(update.media);
  const text = typeof update.text === 'string' ? update.text : '';
  if (!text.trim() && !media) errors.push('the update has neither text nor media');
  if (errors.length) { reject(rejected, id, kind, errors); return null; }
  return { u: update, id, text, media };
}

function mediaOf(value: unknown): JsonObject | null {
  if (!isObj(value)) return null;
  const out: JsonObject = {};
  for (const key of ['link', 'picture', 'thumbnail', 'photo']) { const v = value[key]; if (typeof v === 'string' && isHttpUrl(v)) out[key] = v.trim(); }
  for (const key of ['title', 'description']) { const v = textOf(value[key]); if (v) out[key] = v; }
  return Object.keys(out).length ? out : null;
}

function sentRow(update: unknown, profileId: string, channel: { network: string; targetId: string }, where: string, index: number, rejected: RejectedRow[], warnings: ImportWarning[]): Built | null {
  const base = commonUpdate(update, profileId, where, index, 'sent', rejected);
  if (!base) return null;
  const { u, id, text, media } = base;
  const errors: string[] = [];
  if (typeof u.status === 'string' && u.status.toLowerCase() !== 'sent') errors.push(`it is listed as sent but its status is "${u.status}"`);
  const postedAt = unixToIso(u.sent_at) ?? unixToIso(u.due_at);
  if (!postedAt) errors.push('the update has no sent time');
  if (errors.length) { reject(rejected, id, 'sent', errors); return null; }
  const networkId = idOf(u.service_update_id);
  let url = typeof u.service_link === 'string' && isHttpUrl(u.service_link) ? u.service_link.trim() : null;
  if (!url && channel.network === 'x' && networkId && /^\d+$/.test(networkId)) url = `https://x.com/i/status/${networkId}`;
  if (!url) warnings.push({ code: 'no_permalink', message: `Sent post ${id} has no link on its network; it is imported without one.`, id });
  const results: JsonObject = {};
  if (isObj(u.statistics)) for (const [key, v] of Object.entries(u.statistics)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) results[key] = v;
  return {
    updateId: id,
    row: {
      kind: 'sent', sourceId: sentTargetId(id),
      payload: {
        network: channel.network, channel_key: channel.targetId, url, network_id: networkId, text, posted_at: postedAt!,
        state: 'posted', route: 'published', confirmation: null, results, results_source: 'buffer', media, via: textOf(u.via),
        import_ref: { source: 'buffer', update_id: id, profile_id: profileId },
      },
    },
  };
}

function pendingRow(update: unknown, profileId: string, channel: { network: string; targetId: string }, where: string, index: number, rejected: RejectedRow[], warnings: ImportWarning[]): Built | null {
  const base = commonUpdate(update, profileId, where, index, 'queued', rejected);
  if (!base) return null;
  const { u, id, text, media } = base;
  if (typeof u.status === 'string' && u.status.toLowerCase() === 'sent') { reject(rejected, id, 'queued', ['it is listed as pending but its status is "sent"']); return null; }
  const isDraft = u.draft === true;
  const scheduledAt = unixToIso(u.due_at) ?? unixToIso(u.scheduled_at);
  const limit = GRAPHEME_LIMITS[channel.network];
  if (limit && graphemeCount(text) > limit) warnings.push({ code: 'over_limit', message: `Post ${id} is longer than ${channel.network}'s ${limit}-character limit; it needs shortening before it can be released.`, id });
  const payload: JsonObject = {
    format: 'post', state: isDraft ? 'draft' : 'paused', network: channel.network, channel_key: channel.targetId, text, scheduled_at: isDraft ? null : scheduledAt, media,
    hold: isDraft ? null : { owner_id: null, reason: 'imported_from_buffer', next_attempt_at: null },
    import_ref: { source: 'buffer', update_id: id, profile_id: profileId },
  };
  return { updateId: id, row: { kind: isDraft ? 'buffer_draft' : 'queued', sourceId: isDraft ? draftTargetId(id) : queuedTargetId(id), payload } };
}
