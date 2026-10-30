/**
 * Screening: what becomes a finding. STUMP-WATCH-013.1 to .4, .7, STUMP-WATCH-002.6, STUMP-WATCH-004.1.
 *
 * Pure functions over findings. The spine calls `screenFindings` with the watch's current terms,
 * filters, team handles and block list on every poll, so a changed filter applies from the next poll
 * and earlier findings stay where they are (nothing here deletes anything).
 */
import type { HnStoryType } from './hn.ts'
import { compileTerms, matchTerms, type CompiledTerms, type TermLogic } from './terms.ts'
import { canonicalUrl } from './url.ts'
import type { Finding, HandleRef, SourceKind } from './types.ts'

export interface SourceFilters {
  /** Story types the watch follows. `story` also covers Show HN and Ask HN. */
  hn?: { story_types?: HnStoryType[] }
  /** Feed addresses the watch follows. */
  rss?: { feeds?: string[] }
  /** Instances and hashtags the watch follows. */
  mastodon?: { instances?: string[]; hashtags?: string[] }
  bluesky?: { langs?: string[] }
}

export type DropReason = 'erased' | 'filter' | 'team' | 'blocked' | 'terms' | 'duplicate'

export interface Dropped {
  finding: Finding
  reason: DropReason
  /** For `duplicate`: the source id of the finding kept. For `terms`: the none-term or missing term. */
  detail?: string
}

export interface ScreenSpec {
  terms?: TermLogic | CompiledTerms
  filters?: SourceFilters
  /** Handles of team members and connected accounts. */
  team_handles?: HandleRef[]
  /** Authors the company blocked. */
  blocked_authors?: HandleRef[]
  /** Canonical URLs of findings already stored; a finding with one of these is a duplicate. */
  known_urls?: Iterable<string>
  /** Findings of a person the company erased (their post, or anything they wrote on that source). */
  erased?: ReadonlySet<Finding>
}

export interface ScreenResult {
  kept: Finding[]
  dropped: Dropped[]
}

/** `@Alice`, ` alice ` and `ALICE` compare equal; internal spacing collapses. */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').replace(/\s+/g, ' ').toLowerCase().normalize('NFKC')
}

function refParts(ref: HandleRef): { source?: SourceKind; handle: string } {
  return typeof ref === 'string' ? { handle: normalizeHandle(ref) } : { source: ref.source, handle: normalizeHandle(ref.handle) }
}

/**
 * A Mastodon author is stored as `acct@instance`. A person lists their own account the way they see
 * it on their home instance (`@acme`), so a bare handle also matches the local part of an author
 * whose instance is the one the finding came from.
 */
function localMastodonAccount(finding: Finding, author: string): string | null {
  if (finding.source !== 'mastodon') return null
  const at = author.lastIndexOf('@')
  if (at <= 0) return null
  return author.slice(at + 1) === finding.source_ref.toLowerCase() ? author.slice(0, at) : null
}

/** True when the finding's author matches any handle: by handle or name, or by the source's stable author id. */
export function isListedAuthor(finding: Finding, refs: HandleRef[] | undefined): boolean {
  if (!refs?.length) return false
  const author = normalizeHandle(finding.author)
  const id = finding.author_id?.toLowerCase()
  const local = localMastodonAccount(finding, author)
  for (const ref of refs) {
    const { source, handle } = refParts(ref)
    if (!handle) continue
    if (source && source !== finding.source) continue
    if ((author && author === handle) || (id && id === handle)) return true
    if (local && !handle.includes('@') && local === handle) return true
  }
  return false
}

function passesFilters(f: Finding, filters: SourceFilters | undefined): boolean {
  if (!filters) return true
  if (f.source === 'hn' && filters.hn?.story_types?.length) {
    const types = new Set<string>(filters.hn.story_types)
    if (types.has('story')) {
      types.add('show_hn')
      types.add('ask_hn')
    }
    return types.has(f.kind)
  }
  if (f.source === 'rss' && filters.rss?.feeds?.length) {
    const feeds = new Set(filters.rss.feeds.map(canonicalUrl))
    return feeds.has(canonicalUrl(f.source_ref))
  }
  if (f.source === 'mastodon') {
    const { instances, hashtags } = filters.mastodon ?? {}
    if (instances?.length && !instances.map((i) => i.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')).includes(f.source_ref)) {
      return false
    }
    if (hashtags?.length) {
      const wanted = hashtags.map((h) => h.replace(/^#/, '').toLowerCase())
      if (!(f.hashtags ?? []).some((h) => wanted.includes(h))) return false
    }
    return true
  }
  if (f.source === 'bluesky' && filters.bluesky?.langs?.length) {
    return !!f.language && filters.bluesky.langs.map((l) => l.toLowerCase()).includes(f.language.toLowerCase())
  }
  return true
}

export function screenFindings(findings: Finding[], spec: ScreenSpec): ScreenResult {
  const terms = compileTerms(spec.terms ?? {})
  const seen = new Map<string, string>()
  for (const u of spec.known_urls ?? []) seen.set(canonicalUrl(u), 'known')
  const kept: Finding[] = []
  const dropped: Dropped[] = []
  for (const f of findings) {
    if (spec.erased?.has(f)) {
      dropped.push({ finding: f, reason: 'erased' })
      continue
    }
    if (!passesFilters(f, spec.filters)) {
      dropped.push({ finding: f, reason: 'filter' })
      continue
    }
    if (isListedAuthor(f, spec.team_handles)) {
      dropped.push({ finding: f, reason: 'team' })
      continue
    }
    if (isListedAuthor(f, spec.blocked_authors)) {
      dropped.push({ finding: f, reason: 'blocked' })
      continue
    }
    const m = matchTerms(terms, { title: f.title, text: f.text, links: f.links.join('\n'), transcript: undefined })
    // A none-term in the title, text or links always drops the finding. A transcript finding is exempt
    // only from missing positive terms: those were matched in the transcript at fetch time, and the
    // transcript text is not kept on the finding.
    if (m.excluded_by.length > 0 || (!m.matches && !f.transcript_url)) {
      dropped.push({ finding: f, reason: 'terms', detail: m.excluded_by[0] ?? m.missing_all[0] })
      continue
    }
    const key = canonicalUrl(f.url)
    const prior = seen.get(key)
    if (prior) {
      dropped.push({ finding: f, reason: 'duplicate', detail: prior })
      continue
    }
    seen.set(key, f.source_id)
    kept.push(f)
  }
  return { kept, dropped }
}
