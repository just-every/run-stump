// Reader for the Markdown venue list of 19 Oct 2026 (the "outreach" format):
//   - a front matter header with `date` and `counts`;
//   - per-product sections of entries, each `### <id> — <location>` followed by a
//     `- key: value` list, `#### Draft` (an optional `Title:` line and a fenced
//     block), `#### Alternate drafts` (`##### Alternate N — label`) and
//     `#### Extra copy` (`##### heading`);
//   - `## Venue directory` with `### <venue_id> — <name>` records;
//   - `## Not recommended` with `### <name>` records holding `reason` and `alternative`.
// Lists are inline JSON arrays, booleans are true/false, an empty value means
// none, and indented lines continue the value above them. Headings and keys
// inside fenced blocks are text, never structure.
// The format is read from the file itself; no provider documentation applies.
import type { ImportWarning, ImportLimits, ParsedVenueList, RejectedRow } from './types.ts';
import { DEFAULT_LIMITS, ImportInputError } from './types.ts';
import { isHttpUrl, normalizeVenueUrl } from './url.ts';
import { assembleVenueList, type AlternateDraft, type EntryDraft, type ExtraCopyDraft, type VenueDraft } from './venue-assemble.ts';
import { checkUrlList, listedColumnRule, normalizePriority, normalizeStatus, parseBool, parseJsonStringList, parseLinkCheck, str, uniqueFolded } from './venue-fields.ts';

type Mode = 'prose' | 'entries' | 'venues' | 'excluded';
type Sub = 'keys' | 'draft' | 'alternates' | 'extra' | 'other';

interface Block {
  mode: 'entries' | 'venues' | 'excluded';
  heading: string;
  line: number;
  keys: Map<string, string>;
  duplicateKeys: string[];
  lastKey: string | null;
  sub: Sub;
  title: string | null;
  draftText: string | null;
  alternates: AlternateDraft[];
  extra: ExtraCopyDraft[];
  fenceCount: number;
}

const PROSE_SECTIONS = new Set(['overview', 'how to use', 'posting rhythm', 'start here', 'index']);
// `- key: value`, also written `* Key name: value`; the key reads lower-case with underscores.
const KEY_LINE = /^[-*] ([A-Za-z][A-Za-z0-9_ ]*?):(?:[ \t]+(.*))?$/;
const keyName = (key: string) => key.trim().toLowerCase().replace(/\s+/g, '_');
// The id and the name are split by an em dash, as the format writes it; an en dash or a spaced hyphen reads the same.
const SEPARATORS = [' — ', ' – ', ' -- ', ' - '];
const VENUE_SECTIONS = new Set(['venue directory', 'venues', 'venue list', 'directory']);
const EXCLUDED_SECTIONS = new Set(['not recommended', 'excluded', 'excluded venues']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseOutreachMarkdown(input: string, limits: Partial<ImportLimits> = {}): ParsedVenueList {
  const max = { ...DEFAULT_LIMITS, ...limits };
  if (typeof input !== 'string') throw new ImportInputError('not_text', 'The venue list must be text.');
  if (input.length > max.maxChars) throw new ImportInputError('input_too_large', `The venue list is ${input.length} characters; the limit is ${max.maxChars}.`);
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  const header = readFrontMatter(lines);
  const venues: VenueDraft[] = [];
  const excluded: VenueDraft[] = [];
  const entries: EntryDraft[] = [];
  const rejected: RejectedRow[] = [];
  const warnings: ImportWarning[] = [];
  let rows = 0;
  let sawStructure = false;

  let mode: Mode = 'prose';
  let block: Block | null = null;
  let fence: { ticks: number; lines: string[] } | null = null;

  const flush = () => {
    if (!block) return;
    const done = block;
    block = null;
    if (done.keys.size === 0) return; // prose under a ### heading
    sawStructure = true;
    if (++rows > max.maxRows) throw new ImportInputError('too_many_rows', `The venue list holds more than ${max.maxRows} rows.`);
    if (done.mode === 'entries') finishEntry(done, entries, rejected);
    else if (done.mode === 'venues') finishVenue(done, venues, rejected);
    else finishExcluded(done, excluded, rejected);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;
    if (fence) {
      const close = /^ {0,3}(`{3,})\s*$/.exec(raw);
      if (close && close[1]!.length >= fence.ticks) {
        const body = fence.lines.join('\n').replace(/^\n+|\s+$/g, '');
        fence = null;
        if (block) takeFence(block, body);
      } else fence.lines.push(raw);
      continue;
    }
    const open = /^ {0,3}(`{3,})[^`]*$/.exec(raw);
    if (open) { fence = { ticks: open[1]!.length, lines: [] }; continue; }

    if (raw.startsWith('## ')) {
      flush();
      const title = raw.slice(3).trim().toLowerCase();
      mode = VENUE_SECTIONS.has(title) ? 'venues' : EXCLUDED_SECTIONS.has(title) ? 'excluded' : PROSE_SECTIONS.has(title) ? 'prose' : 'entries';
      continue;
    }
    if (raw.startsWith('### ')) {
      flush();
      if (mode !== 'prose') block = newBlock(mode, raw.slice(4).trim(), lineNo);
      continue;
    }
    if (!block) continue;
    if (raw.startsWith('#### ')) {
      const name = raw.slice(5).trim().toLowerCase();
      block.sub = name === 'draft' ? 'draft' : name === 'alternate drafts' ? 'alternates' : name === 'extra copy' ? 'extra' : 'other';
      block.title = block.sub === 'draft' ? null : block.title;
      continue;
    }
    if (raw.startsWith('##### ')) {
      const heading = raw.slice(6).trim();
      if (block.sub === 'alternates') block.alternates.push({ label: heading, title: null, text: '' });
      else if (block.sub === 'extra') block.extra.push({ heading, text: '' });
      continue;
    }
    if (block.sub === 'keys') {
      const match = KEY_LINE.exec(raw.trimEnd());
      if (match) {
        const key = keyName(match[1]!);
        if (block.keys.has(key)) block.duplicateKeys.push(key);
        else block.keys.set(key, (match[2] ?? '').trim());
        block.lastKey = key;
      } else if (/^[ \t]+\S/.test(raw) && block.lastKey) {
        const previous = block.keys.get(block.lastKey) ?? '';
        block.keys.set(block.lastKey, `${previous} ${raw.trim()}`.trim());
      }
      continue;
    }
    const titleMatch = /^Title:[ \t]*(.*)$/.exec(raw);
    if (titleMatch) {
      const title = titleMatch[1]!.trim();
      const value = title === '(none)' || title === '' ? null : title;
      if (block.sub === 'draft') block.title = value;
      else if (block.sub === 'alternates' && block.alternates.length) block.alternates[block.alternates.length - 1]!.title = value;
      continue;
    }
    if (block.sub === 'extra' && block.extra.length && raw.trim()) {
      const last = block.extra[block.extra.length - 1]!;
      if (!last.text) last.text = raw.trim();
    }
  }
  if (fence) warnings.push({ code: 'unterminated_fence', message: 'A fenced block was still open at the end of the file; its text was dropped.' });
  flush();

  if (!sawStructure) throw new ImportInputError('not_venue_list', 'No venues were found. Put them under a "## Venue directory" heading, each as "### <venue_id> — <name>" followed by "- url: https://…" and "- status: ready" lines (other keys are optional). Excluded venues go under "## Not recommended" with "- reason:". Entries with drafts go under a heading named for the product. docs/import-venues.md has a full example.');

  const result = assembleVenueList({ source: 'outreach-md', listDate: header.date, venues, excluded, entries, rejected, warnings });
  compareHeaderCounts(header, result, result.warnings);
  return result;
}

function newBlock(mode: 'entries' | 'venues' | 'excluded', heading: string, line: number): Block {
  return { mode, heading, line, keys: new Map(), duplicateKeys: [], lastKey: null, sub: 'keys', title: null, draftText: null, alternates: [], extra: [], fenceCount: 0 };
}

function takeFence(block: Block, body: string): void {
  if (block.sub === 'draft') {
    if (block.draftText === null) block.draftText = body;
  } else if (block.sub === 'alternates' && block.alternates.length) {
    const alt = block.alternates[block.alternates.length - 1]!;
    if (!alt.text) alt.text = body;
  } else if (block.sub === 'extra' && block.extra.length) {
    const extra = block.extra[block.extra.length - 1]!;
    extra.text = extra.text && extra.text !== body ? `${extra.text}\n\n${body}` : body;
  }
}

interface Header { date: string | null; counts: Record<string, number> }

function readFrontMatter(lines: string[]): Header {
  const header: Header = { date: null, counts: {} };
  if (lines[0]?.trim() !== '---') return header;
  let inCounts = false;
  for (let i = 1; i < lines.length && lines[i]!.trim() !== '---'; i++) {
    const line = lines[i]!;
    const top = /^([a-z_]+):[ \t]*(.*)$/.exec(line);
    if (top) {
      inCounts = top[1] === 'counts';
      if (top[1] === 'date') header.date = top[2]!.trim().replace(/^"|"$/g, '') || null;
      continue;
    }
    const nested = /^ {2}([a-z_]+):[ \t]*(\d+)\s*$/.exec(line);
    if (inCounts && nested) header.counts[nested[1]!] = Number(nested[2]);
  }
  if (header.date && !/^\d{4}-\d{2}-\d{2}$/.test(header.date)) header.date = null;
  return header;
}

function compareHeaderCounts(header: Header, parsed: ParsedVenueList, warnings: ImportWarning[]): void {
  const seen = (kind: string) => parsed.rejected.filter(r => r.kind === kind).length;
  const pairs: [string, number, number][] = [
    ['entries', header.counts.entries ?? -1, parsed.summary.entries + seen('entry')],
    ['venues', header.counts.venues ?? -1, parsed.summary.venues + seen('venue')],
    ['excluded', header.counts.excluded ?? -1, parsed.summary.excluded + seen('excluded')],
  ];
  for (const [name, declared, found] of pairs) {
    if (declared >= 0 && declared !== found) warnings.push({ code: 'header_count_differs', message: `The file's header says ${declared} ${name}; ${found} were found. The file may be cut short.` });
  }
}

const reject = (rejected: RejectedRow[], id: string, kind: string, line: number, reasons: string[]) =>
  rejected.push({ id, kind, line, reason: reasons.join('; '), reasons });

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function splitHeading(heading: string): { id: string; location: string } | null {
  for (const separator of SEPARATORS) {
    const at = heading.indexOf(separator);
    if (at >= 0) return { id: heading.slice(0, at).trim(), location: heading.slice(at + separator.length).trim() };
  }
  return null;
}

function finishEntry(block: Block, entries: EntryDraft[], rejected: RejectedRow[]): void {
  const parts = splitHeading(block.heading);
  const id = parts?.id ?? block.heading;
  const errors: string[] = [];
  if (!parts) errors.push('the heading is not "### <id> — <location>"');
  else {
    if (!ID_PATTERN.test(parts.id)) errors.push(`entry id "${parts.id}" is not a plain id`);
    if (!parts.location) errors.push('the heading has no location');
  }
  for (const key of block.duplicateKeys) errors.push(`the key "${key}" appears twice`);
  const get = (key: string) => block.keys.get(key) ?? '';

  const product = get('seed').trim();
  if (!product) errors.push('seed is empty');
  const platform = str(get('platform'));
  if (!platform) errors.push('platform is empty');
  const status = normalizeStatus(get('status'));
  if (!status) errors.push(`status "${get('status')}" is not one of candidate, join-first, ready, editorial, paid, hold or excluded`);
  const priority = normalizePriority(get('priority'));
  if (!priority) errors.push(`priority "${get('priority')}" is not one of top, high, strong, medium, low or fallback`);
  const postType = get('post_type').trim().toLowerCase();
  if (!/^[a-z_]+$/.test(postType)) errors.push(`post_type "${get('post_type')}" is not a word`);
  const human = parseBool(get('human_written_required'));
  if (human === null) errors.push(`human_written_required "${get('human_written_required')}" is not true or false`);
  const venueId = get('venue_id').trim();
  if (!venueId) errors.push('venue_id is empty');

  const postUrl = str(get('post_url'));
  if (postUrl && !isHttpUrl(postUrl)) errors.push(`post_url "${postUrl}" is not an http(s) URL`);
  const communityUrl = str(get('community_url'));
  if (communityUrl && !isHttpUrl(communityUrl)) errors.push(`community_url "${communityUrl}" is not an http(s) URL`);
  const lists: Record<string, string[]> = {};
  for (const key of ['rules_urls', 'evidence_urls', 'sources', 'seeds']) {
    const parsed = parseJsonStringList(get(key));
    if (parsed === null) errors.push(`${key} is not a JSON array of strings`);
    lists[key] = parsed ?? [];
  }
  checkUrlList('rules_urls', lists.rules_urls!, errors);
  checkUrlList('evidence_urls', lists.evidence_urls!, errors);

  if (block.draftText === null || block.draftText.trim() === '') errors.push('there is no draft text under "#### Draft"');

  if (errors.length) { reject(rejected, id, 'entry', block.line, errors); return; }
  entries.push({
    line: block.line, id, venueExternalId: venueId, venueUrlKey: null, product, status: status!, priority, postType, humanWritten: human!,
    postUrl, communityUrl, rulesUrls: lists.rules_urls!, evidenceUrls: lists.evidence_urls!, linkCheck: parseLinkCheck(get('link_check')),
    audience: str(get('audience')), why: str(get('why')), readerValue: str(get('reader_value')), howToPost: str(get('how_to_post')),
    requirements: str(get('requirements')), notes: str(get('notes')), sources: lists.sources!,
    title: block.title, text: block.draftText!, alternates: block.alternates.filter(a => a.text), extraCopy: block.extra.filter(e => e.text),
  });
}

function finishVenue(block: Block, venues: VenueDraft[], rejected: RejectedRow[]): void {
  const parts = splitHeading(block.heading);
  const id = parts?.id ?? block.heading;
  const errors: string[] = [];
  if (!parts) errors.push('the heading is not "### <venue_id> — <name>"');
  else {
    if (!ID_PATTERN.test(parts.id)) errors.push(`venue id "${parts.id}" is not a plain id`);
    if (!parts.location) errors.push('the heading has no name');
  }
  for (const key of block.duplicateKeys) errors.push(`the key "${key}" appears twice`);
  const get = (key: string) => block.keys.get(key) ?? '';
  const url = str(get('url'));
  if (!url) errors.push('url is empty');
  else if (!normalizeVenueUrl(url)) errors.push(`url "${url}" is not an http(s) URL`);
  const status = normalizeStatus(get('status'));
  if (!status) errors.push(`status "${get('status')}" is not one of candidate, join-first, ready, editorial, paid, hold or excluded`);
  else if (status === 'excluded') errors.push('a venue in the directory cannot have status excluded; exclusions belong under "Not recommended"');
  const lists: Record<string, string[]> = {};
  for (const key of ['rules_urls', 'seeds', 'entries']) {
    const parsed = parseJsonStringList(get(key));
    if (parsed === null) errors.push(`${key} is not a JSON array of strings`);
    lists[key] = parsed ?? [];
  }
  checkUrlList('rules_urls', lists.rules_urls!, errors);
  const human = get('human_written_required').trim() ? parseBool(get('human_written_required')) : false;
  if (human === null) errors.push(`human_written_required "${get('human_written_required')}" is not true or false`);
  const readAt = str(get('rules_read_at'));
  if (readAt && !DATE.test(readAt)) errors.push(`rules_read_at "${readAt}" is not a date (YYYY-MM-DD)`);
  const priority = get('priority').trim() ? normalizePriority(get('priority')) : null;
  if (get('priority').trim() && !priority) errors.push(`priority "${get('priority')}" is not one of top, high, strong, medium, low or fallback`);
  for (const key of ['posting', 'links', 'disclosure_line'] as const) listedColumnRule(key, get(key), [], null, errors);
  if (errors.length) { reject(rejected, id, 'venue', block.line, errors); return; }
  venues.push({
    line: block.line, externalId: parts!.id, name: parts!.location, url, platform: str(get('platform')), explicitKind: get('kind'), status: status!,
    audience: str(get('audience')), promotionRoute: str(get('promotion_route')) ?? str(get('how_to_post')), rulesText: str(get('rules')), rulesUrls: lists.rules_urls!,
    sharedLimit: str(get('shared_limit')), reception: str(get('reception')), products: uniqueFolded(lists.seeds!), humanWritten: human === true,
    humanWrittenStated: get('human_written_required').trim() !== '', priority, excluded: null, sources: [], listedEntryIds: lists.entries!,
    requirements: str(get('requirements')), why: str(get('why')), readerValue: str(get('reader_value')), rulesReadAt: readAt,
    posting: str(get('posting')), links: str(get('links')), disclosureLine: str(get('disclosure_line')),
  });
}

function finishExcluded(block: Block, excluded: VenueDraft[], rejected: RejectedRow[]): void {
  const name = block.heading;
  const errors: string[] = [];
  if (!name) errors.push('the heading has no name');
  for (const key of block.duplicateKeys) errors.push(`the key "${key}" appears twice`);
  const get = (key: string) => block.keys.get(key) ?? '';
  const url = str(get('url'));
  if (url && !normalizeVenueUrl(url)) errors.push(`url "${url}" is not an http(s) URL`);
  const reason = str(get('reason'));
  if (!reason) errors.push('an excluded venue needs a reason');
  const seeds = parseJsonStringList(get('seeds'));
  if (seeds === null) errors.push('seeds is not a JSON array of strings');
  const sources = parseJsonStringList(get('sources'));
  if (sources === null) errors.push('sources is not a JSON array of strings');
  if (errors.length) { reject(rejected, name || `line ${block.line}`, 'excluded', block.line, errors); return; }
  excluded.push({
    line: block.line, externalId: null, name, url, platform: null, explicitKind: '', status: 'excluded', audience: null, promotionRoute: null,
    rulesText: null, rulesUrls: [], sharedLimit: null, reception: null, products: uniqueFolded(seeds ?? []), humanWritten: false, humanWrittenStated: false, priority: null,
    excluded: { reason: reason!, alternative: str(get('alternative')) }, sources: sources ?? [], listedEntryIds: [], requirements: null, why: null, readerValue: null, rulesReadAt: null,
    posting: null, links: null, disclosureLine: null,
  });
}
