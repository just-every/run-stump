// Reader for a venue-list CSV whose header names the same keys as the
// Markdown list. One row per venue; a row that also carries `entry_id` adds
// one draft entry for that venue (several rows may name the same venue, and
// must then agree on the venue's own fields).
//
// Venue columns:  venue_id, name, url, platform, kind, status, priority, audience,
//   promotion_route, rules, rules_urls, rules_read_at, shared_limit, reception, seeds
//   (or products), human_written_required, requirements, why, reader_value, reason,
//   alternative, sources, and the rules posting, links and disclosure_line.
// Entry columns:  entry_id, product, post_type, post_url, community_url, how_to_post,
//   requirements, why, reader_value, notes, draft_title, draft.
// A row with a `reason`, or status "excluded", is an excluded venue.
// List cells are an inline JSON array or items separated by semicolons.
import type { ImportLimits, JsonObject, ParsedVenueList, RejectedRow } from './types.ts';
import { DEFAULT_LIMITS, ImportInputError } from './types.ts';
import { parseCsv } from './csv.ts';
import { normalizeVenueUrl } from './url.ts';
import { assembleVenueList, venueKey, type EntryDraft, type VenueDraft } from './venue-assemble.ts';
import { checkUrlList, listedColumnRule, normalizePriority, normalizeStatus, parseBool, parseLinkCheck, parseListCell, str, uniqueFolded } from './venue-fields.ts';

const ALIASES: Record<string, string> = {
  id: 'venue_id', venue: 'name', title: 'name', link: 'url', website: 'url', type: 'kind',
  seed: 'product', products: 'seeds', rule: 'rules', limit: 'shared_limit', route: 'promotion_route',
  draft_text: 'draft', human_written: 'human_written_required', reasons: 'reason',
  rules_url: 'rules_urls', rule_url: 'rules_urls', rules_link: 'rules_urls', rules_links: 'rules_urls', why_it_matters: 'why',
  read_at: 'rules_read_at', rules_read_on: 'rules_read_at', read_on: 'rules_read_at', requirement: 'requirements',
  posting_rule: 'posting', who_posts: 'posting', links_rule: 'links', disclosure: 'disclosure_line',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const normalizeHeader = (h: string): string => {
  const key = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIASES[key] ?? key;
};

export function parseVenuesCsv(input: string, limits: Partial<ImportLimits> = {}): ParsedVenueList {
  const max = { ...DEFAULT_LIMITS, ...limits };
  if (typeof input !== 'string') throw new ImportInputError('not_text', 'The venue list must be text.');
  if (input.length > max.maxChars) throw new ImportInputError('input_too_large', `The CSV is ${input.length} characters; the limit is ${max.maxChars}.`);
  const table = parseCsv(input, max.maxRows);
  const header = table.header.map(normalizeHeader);
  if (!header.includes('url') && !header.includes('name')) throw new ImportInputError('csv_missing_column', 'The CSV needs a "name" or "url" column.');

  const venues: VenueDraft[] = [];
  const excluded: VenueDraft[] = [];
  const entries: EntryDraft[] = [];
  const rejected: RejectedRow[] = [];
  const byKey = new Map<string, VenueDraft>();

  for (const row of table.rows) {
    const cells = new Map<string, string>();
    header.forEach((name, index) => { if (!cells.has(name)) cells.set(name, row.cells[index] ?? ''); });
    const get = (key: string) => (cells.get(key) ?? '').trim();
    const errors: string[] = [];
    const externalId = str(get('venue_id'));
    const url = str(get('url'));
    const reason = str(get('reason'));
    const status = normalizeStatus(get('status'));
    const isExcluded = reason !== null || status === 'excluded';
    let name = str(get('name')) ?? externalId;
    const entryIdEarly = str(get('entry_id'));
    const id = entryIdEarly ?? externalId ?? name ?? url ?? `line ${row.line}`;
    if (!name && url) name = normalizeVenueUrl(url);
    if (!name) errors.push('name is empty');
    if (url && !normalizeVenueUrl(url)) errors.push(`url "${url}" is not an http(s) URL`);
    if (!url && !isExcluded) errors.push(get('community_url') ? 'url is empty: put the venue\'s address in the url column (community_url is an entry\'s own link)' : 'url is empty');
    if (isExcluded && !reason) errors.push('an excluded venue needs a reason');
    if (!isExcluded && !status) errors.push(`status "${get('status')}" is not one of candidate, join-first, ready, editorial, paid, hold or excluded`);
    const priority = get('priority') ? normalizePriority(get('priority')) : null;
    if (get('priority') && !priority) errors.push(`priority "${get('priority')}" is not one of top, high, strong, medium, low or fallback`);
    const human = parseBool(get('human_written_required'));
    if (human === null) errors.push(`human_written_required "${get('human_written_required')}" is not true or false`);
    const lists: Record<string, string[]> = {};
    for (const key of ['rules_urls', 'seeds', 'sources']) {
      const parsed = parseListCell(get(key));
      if (parsed === null) errors.push(`${key} is not a JSON array of strings`);
      lists[key] = parsed ?? [];
    }
    checkUrlList('rules_urls', lists.rules_urls!, errors);
    const readAt = str(get('rules_read_at'));
    if (readAt && !DATE.test(readAt)) errors.push(`rules_read_at "${readAt}" is not a date (YYYY-MM-DD)`);
    for (const key of ['posting', 'links', 'disclosure_line'] as const) listedColumnRule(key, get(key), [], null, errors);

    const entryId = str(get('entry_id'));
    let entry: EntryDraft | null = null;
    if (entryId) {
      const products = uniqueFolded(lists.seeds!);
      const product = str(get('product')) ?? (products.length === 1 ? products[0]! : null);
      if (!product) errors.push('an entry row needs a product');
      const text = get('draft');
      if (!text.trim()) errors.push('an entry row needs draft text');
      const postType = (get('post_type') || 'direct').toLowerCase();
      if (!/^[a-z_]+$/.test(postType)) errors.push(`post_type "${get('post_type')}" is not a word`);
      for (const key of ['post_url', 'community_url']) if (get(key) && !normalizeVenueUrl(get(key))) errors.push(`${key} "${get(key)}" is not an http(s) URL`);
      if (!errors.length) {
        entry = {
          line: row.line, id: entryId, venueExternalId: null, venueUrlKey: null, product: product!, status: status ?? 'candidate', priority, postType,
          humanWritten: human === true, postUrl: str(get('post_url')), communityUrl: str(get('community_url')), rulesUrls: lists.rules_urls!, evidenceUrls: [],
          linkCheck: parseLinkCheck(get('link_check')), audience: str(get('audience')), why: str(get('why')), readerValue: str(get('reader_value')),
          howToPost: str(get('how_to_post')), requirements: str(get('requirements')), notes: str(get('notes')), sources: lists.sources!,
          title: str(get('draft_title')), text, alternates: [], extraCopy: [],
        };
      }
    }

    const draft: VenueDraft | null = errors.length ? null : {
      line: row.line, externalId, name: name!, url, platform: str(get('platform')), explicitKind: get('kind'), status: isExcluded ? 'excluded' : status!,
      audience: str(get('audience')), promotionRoute: str(get('promotion_route')) ?? (entryId ? null : str(get('how_to_post'))), rulesText: str(get('rules')),
      rulesUrls: lists.rules_urls!, sharedLimit: str(get('shared_limit')), reception: str(get('reception')), products: uniqueFolded(lists.seeds!),
      humanWritten: human === true, humanWrittenStated: get('human_written_required') !== '', priority: entryId ? null : priority,
      excluded: isExcluded ? { reason: reason!, alternative: str(get('alternative')) } : null, sources: lists.sources!, listedEntryIds: [],
      requirements: str(get('requirements')), why: str(get('why')), readerValue: str(get('reader_value')), rulesReadAt: readAt,
      posting: str(get('posting')), links: str(get('links')), disclosureLine: str(get('disclosure_line')),
    };
    if (!draft) { rejected.push({ id, kind: entryId ? 'entry' : isExcluded ? 'excluded' : 'venue', line: row.line, reason: errors.join('; '), reasons: errors }); continue; }

    const key = venueKey(draft);
    const earlier = byKey.get(key);
    if (earlier) {
      const conflict = mergeVenueRow(earlier, draft);
      if (conflict) { rejected.push({ id, kind: entryId ? 'entry' : 'venue', line: row.line, reason: conflict, reasons: [conflict] }); continue; }
    } else {
      byKey.set(key, draft);
      (draft.excluded ? excluded : venues).push(draft);
    }
    if (entry) { entry.venueUrlKey = key; entries.push(entry); }
  }

  return assembleVenueList({ source: 'venues-csv', listDate: null, venues, excluded, entries, rejected, warnings: [] });
}

const SCALARS = ['externalId', 'platform', 'audience', 'promotionRoute', 'rulesText', 'sharedLimit', 'reception', 'priority', 'posting', 'links', 'disclosureLine'] as const;

/** Fold a later row about the same venue into the first; returns a reason when the rows disagree. */
function mergeVenueRow(first: VenueDraft, later: VenueDraft): string | null {
  for (const field of SCALARS) {
    const a = first[field], b = later[field];
    if (a !== null && b !== null && a !== b) return `disagrees with line ${first.line} about "${first.name}": ${field} is "${b}" here and "${a}" there`;
  }
  if (first.status !== later.status) return `disagrees with line ${first.line} about "${first.name}": status is "${later.status}" here and "${first.status}" there`;
  if ((first.excluded?.reason ?? null) !== (later.excluded?.reason ?? null)) return `disagrees with line ${first.line} about "${first.name}": the exclusion differs`;
  for (const field of SCALARS) if (first[field] === null) (first as unknown as JsonObject)[field] = later[field];
  first.rulesUrls = [...new Set([...first.rulesUrls, ...later.rulesUrls])];
  first.products = uniqueFolded([...first.products, ...later.products]);
  first.sources = [...new Set([...first.sources, ...later.sources])];
  first.humanWritten = first.humanWritten || later.humanWritten;
  first.humanWrittenStated = first.humanWrittenStated || later.humanWrittenStated;
  first.requirements ??= later.requirements;
  first.why ??= later.why;
  first.readerValue ??= later.readerValue;
  first.rulesReadAt ??= later.rulesReadAt;
  return null;
}
