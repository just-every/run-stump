// Turns field-level venue and entry drafts, from either reader, into the
// normalized rows, rejections and warnings of one venue-list import. Both
// readers go through here so the Markdown and the CSV make the same venues.
import type { ImportRow, ImportWarning, Json, JsonObject, ParsedVenueList, RejectedRow } from './types.ts';
import { foldName, normalizeVenueUrl } from './url.ts';
import { aiTextRule, gatesRule, inferKind, jsonList, parseSharedLimit, strongestPriority, type VenueStatus } from './venue-fields.ts';

export interface VenueDraft {
  line: number;
  externalId: string | null;
  name: string;
  url: string | null;
  platform: string | null;
  explicitKind: string;
  status: VenueStatus;
  audience: string | null;
  promotionRoute: string | null;
  rulesText: string | null;
  rulesUrls: string[];
  sharedLimit: string | null;
  reception: string | null;
  products: string[];
  humanWritten: boolean;
  /** The list says outright whether human-written text is required (true or false), not just left it empty. */
  humanWrittenStated: boolean;
  priority: string | null;
  excluded: { reason: string; alternative: string | null } | null;
  sources: string[];
  listedEntryIds: string[];
  /** What posting there takes ("100 karma, account 30 days old"), why it matters, and what readers get. */
  requirements: string | null;
  why: string | null;
  readerValue: string | null;
  /** The day the rules pages were read; the Markdown list's own date when it has none. */
  rulesReadAt: string | null;
}

export interface AlternateDraft { label: string; title: string | null; text: string }
export interface ExtraCopyDraft { heading: string; text: string }

export interface EntryDraft {
  line: number;
  id: string;
  /** Set by the Markdown reader; resolved against the directory's venue ids. */
  venueExternalId: string | null;
  /** Set by the CSV reader; the normalized URL key of the venue on the same row. */
  venueUrlKey: string | null;
  product: string;
  status: VenueStatus;
  priority: string | null;
  postType: string;
  humanWritten: boolean;
  postUrl: string | null;
  communityUrl: string | null;
  rulesUrls: string[];
  evidenceUrls: string[];
  linkCheck: JsonObject | null;
  audience: string | null;
  why: string | null;
  readerValue: string | null;
  howToPost: string | null;
  requirements: string | null;
  notes: string | null;
  sources: string[];
  title: string | null;
  text: string;
  alternates: AlternateDraft[];
  extraCopy: ExtraCopyDraft[];
}

export interface VenueListInput {
  source: 'outreach-md' | 'venues-csv';
  listDate: string | null;
  venues: VenueDraft[];
  excluded: VenueDraft[];
  entries: EntryDraft[];
  rejected: RejectedRow[];
  warnings: ImportWarning[];
}

export const venueKey = (v: Pick<VenueDraft, 'url' | 'name'>): string => {
  const normalized = v.url ? normalizeVenueUrl(v.url) : null;
  return normalized ?? `name:${foldName(v.name)}`;
};
export const venueTargetId = (key: string): string => `venue:${key}`;
export const draftTargetId = (entryId: string): string => `outreach-entry:${entryId}`;

const reject = (id: string, kind: string, line: number | null, reasons: string[]): RejectedRow => ({ id, kind, line, reason: reasons.join('; '), reasons });

export function assembleVenueList(input: VenueListInput): ParsedVenueList {
  const rejected = [...input.rejected];
  const warnings = [...input.warnings];

  // Directory venues, once each.
  const byKey = new Map<string, VenueDraft>();
  const byExternalId = new Map<string, VenueDraft>();
  const keptVenues: VenueDraft[] = [];
  for (const venue of input.venues) {
    const key = venueKey(venue);
    const sameKey = byKey.get(key);
    const sameId = venue.externalId ? byExternalId.get(venue.externalId) : undefined;
    if (sameKey || sameId) {
      const first = sameKey ?? sameId!;
      rejected.push(reject(venue.externalId ?? venue.name, 'venue', venue.line, [`the same place as "${first.name}" (${first.externalId ?? 'no id'}, line ${first.line}), which is imported once`]));
      continue;
    }
    byKey.set(key, venue);
    if (venue.externalId) byExternalId.set(venue.externalId, venue);
    keptVenues.push(venue);
  }

  // Exclusions: keep each once; an exclusion on a listed venue wins over its listing.
  const excludedByKey = new Map<string, VenueDraft>();
  const keptExcluded: VenueDraft[] = [];
  const mergedKeys = new Set<string>();
  let acceptedExclusions = 0;
  for (const venue of input.excluded) {
    const key = venueKey(venue);
    const earlier = excludedByKey.get(key);
    if (earlier) {
      const same = earlier.excluded!.reason === venue.excluded!.reason && (earlier.excluded!.alternative ?? '') === (venue.excluded!.alternative ?? '');
      if (same) { warnings.push({ code: 'duplicate_exclusion', message: `"${venue.name}" repeats the exclusion of "${earlier.name}" and is imported once`, id: venue.name }); continue; }
      rejected.push(reject(venue.name, 'excluded', venue.line, [`the same place as the exclusion "${earlier.name}" (line ${earlier.line}) with a different reason`]));
      continue;
    }
    excludedByKey.set(key, venue);
    acceptedExclusions++;
    const listed = byKey.get(key);
    if (listed) {
      mergedKeys.add(key);
      warnings.push({ code: 'excluded_overrides_listing', message: `"${listed.name}" is both listed (${listed.status}) and excluded; it arrives excluded with the exclusion's reason`, id: listed.externalId ?? listed.name });
    }
    keptExcluded.push(venue);
  }

  // Entries need a venue that was kept.
  const acceptedEntries: EntryDraft[] = [];
  const entryIdsSeen = new Set<string>();
  const entriesByVenue = new Map<string, EntryDraft[]>();
  for (const entry of input.entries) {
    const venue = entry.venueUrlKey ? byKey.get(entry.venueUrlKey) ?? excludedByKey.get(entry.venueUrlKey) : entry.venueExternalId ? byExternalId.get(entry.venueExternalId) : undefined;
    if (entryIdsSeen.has(entry.id)) {
      rejected.push(reject(entry.id, 'entry', entry.line, ['an entry with this id is already imported']));
      continue;
    }
    if (!venue) {
      rejected.push(reject(entry.id, 'entry', entry.line, [entry.venueExternalId ? `venue_id "${entry.venueExternalId}" is not in the venue directory` : 'its venue was not imported']));
      continue;
    }
    entryIdsSeen.add(entry.id);
    acceptedEntries.push(entry);
    const key = venueKey(venue);
    const list = entriesByVenue.get(key) ?? [];
    list.push(entry);
    entriesByVenue.set(key, list);
  }
  const knownEntryIds = new Set([...input.entries.map(e => e.id), ...rejected.filter(r => r.kind === 'entry').map(r => r.id)]);
  for (const venue of keptVenues) {
    for (const id of venue.listedEntryIds) {
      if (!knownEntryIds.has(id)) warnings.push({ code: 'venue_lists_unknown_entry', message: `venue "${venue.name}" lists entry "${id}", which is not in the file`, id });
    }
  }

  const rows: ImportRow[] = [];
  const emitted = new Set<string>();
  const emit = (venue: VenueDraft, excludedBy: VenueDraft | null) => {
    const key = venueKey(venue);
    if (emitted.has(key)) return;
    emitted.add(key);
    const entries = entriesByVenue.get(key) ?? [];
    const value = venueValue(venue, excludedBy, entries, input.listDate, warnings);
    rows.push({ kind: 'venue', sourceId: venueTargetId(key), payload: value, line: venue.line });
  };
  for (const venue of keptVenues) emit(excludedByKey.get(venueKey(venue)) ? mergeExcluded(venue, excludedByKey.get(venueKey(venue))!) : venue, excludedByKey.get(venueKey(venue)) ?? null);
  for (const venue of keptExcluded) if (!mergedKeys.has(venueKey(venue))) emit(venue, null);
  for (const entry of acceptedEntries) {
    const venue = entry.venueUrlKey ? byKey.get(entry.venueUrlKey) ?? excludedByKey.get(entry.venueUrlKey)! : byExternalId.get(entry.venueExternalId!)!;
    const targetId = venueTargetId(venueKey(venue));
    rows.push({ kind: 'draft', sourceId: draftTargetId(entry.id), payload: draftValue(entry, targetId, venue), line: entry.line });
  }

  return {
    source: input.source,
    rows,
    rejected,
    warnings,
    summary: { venues: keptVenues.length, entries: acceptedEntries.length, excluded: acceptedExclusions },
  };
}

/** The directory listing with an exclusion laid over it: keep the listing's facts, take the exclusion's reason. */
function mergeExcluded(listed: VenueDraft, exclusion: VenueDraft): VenueDraft {
  return {
    ...listed,
    excluded: exclusion.excluded,
    products: listed.products.length ? listed.products : exclusion.products,
    sources: [...new Set([...listed.sources, ...exclusion.sources])],
    humanWritten: listed.humanWritten,
  };
}

function venueValue(venue: VenueDraft, exclusionOf: VenueDraft | null, entries: EntryDraft[], listDate: string | null, warnings: ImportWarning[]): JsonObject {
  const key = venueKey(venue);
  const isExcluded = venue.excluded !== null;
  const kind = inferKind({ explicit: venue.explicitKind, externalId: venue.externalId, platform: venue.platform ?? '', name: venue.name, url: venue.url });
  if (kind.guessed && !isExcluded) warnings.push({ code: 'kind_guessed', message: `"${venue.name}" has no recognizable kind; it arrives as a forum`, id: venue.externalId ?? venue.name });
  const bannedBy = entries.filter(e => e.humanWritten).map(e => e.id);
  const banned = venue.humanWritten || bannedBy.length > 0;
  // An entry always states it; a venue row states it when its cell is not empty.
  const allowed = !banned && (venue.humanWrittenStated || entries.length > 0);
  const readAt = venue.rulesReadAt ?? listDate;
  const rulesUrls = venue.rulesUrls.length ? venue.rulesUrls : [...new Set(entries.flatMap(e => e.rulesUrls))];
  const rules: JsonObject = {};
  const ai = aiTextRule({ banned, allowed, rulesUrls, readAt, origin: bannedBy.length ? `human_written_required on ${bannedBy.join(', ')}` : 'human_written_required' });
  if (ai) rules.ai_text = ai;
  const requirements = venue.requirements ?? entries.map(e => e.requirements).find((text): text is string => !!text) ?? null;
  const gates = gatesRule(requirements, rulesUrls, readAt);
  if (gates) rules.gates = gates;
  const priorities = [...(venue.priority ? [venue.priority] : []), ...entries.map(e => e.priority).filter((p): p is string => p !== null)];
  const products = [...new Set([...venue.products, ...entries.map(e => e.product)].map(p => p.trim()).filter(Boolean))];
  return {
    kind: kind.kind,
    name: venue.name,
    url: venue.url,
    url_key: key,
    external_id: venue.externalId,
    platform: venue.platform,
    status: isExcluded ? 'excluded' : venue.status,
    listed_status: isExcluded && exclusionOf !== null ? venue.status : null,
    priority: strongestPriority(priorities),
    audience: venue.audience,
    how_to_post: venue.promotionRoute,
    rules_text: venue.rulesText,
    rules_urls: jsonList(rulesUrls),
    rules,
    requirements,
    why: venue.why ?? entries.map(e => e.why).find((text): text is string => !!text) ?? null,
    reader_value: venue.readerValue ?? entries.map(e => e.readerValue).find((text): text is string => !!text) ?? null,
    shared_limit: venue.sharedLimit ? parseSharedLimit(venue.sharedLimit) : null,
    reception: venue.reception,
    products: products.map(name => ({ name })),
    excluded: venue.excluded ? { reason: venue.excluded.reason, alternative: venue.excluded.alternative } : null,
    sources: jsonList(venue.sources),
    archived: false,
  };
}

function draftValue(entry: EntryDraft, venueTargetIdValue: string, venue: VenueDraft): JsonObject {
  const pitch = entry.postType === 'pitch' || entry.postType === 'submission';
  return {
    format: pitch ? 'pitch' : 'post',
    state: 'draft',
    venue_key: venueTargetIdValue,
    venue_external_id: venue.externalId,
    product_name: entry.product,
    title: entry.title,
    text: entry.text,
    alternates: entry.alternates.map(a => ({ label: a.label, title: a.title, text: a.text })),
    extra_copy: entry.extraCopy.map(e => ({ heading: e.heading, text: e.text })),
    own_words_required: entry.humanWritten,
    post_type: entry.postType,
    listed_status: entry.status,
    priority: entry.priority,
    post_url: entry.postUrl,
    community_url: entry.communityUrl,
    rules_urls: jsonList(entry.rulesUrls),
    evidence_urls: jsonList(entry.evidenceUrls),
    link_check: entry.linkCheck,
    audience: entry.audience,
    why: entry.why,
    reader_value: entry.readerValue,
    how_to_post: entry.howToPost,
    requirements: entry.requirements,
    notes: entry.notes,
    sources: jsonList(entry.sources),
    entry_id: entry.id,
  } satisfies { [key: string]: Json };
}
