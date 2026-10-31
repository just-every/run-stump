// What an erasure leaves behind so the erased person's findings stay erased
// (STUMP-DATA-002): a digest of each erased finding's canonical address and of
// the person's handle (and author id) on each source findings come from. A poll
// drops a finding whose address or author is among them before it is stored,
// so no later poll, overlap window or backfill brings the person back or alerts
// with their post. Only digests are kept, never the address or the handle.
import type { D1Sql } from '../../modules/import-kit/src/d1/index.ts'
import { canonicalUrl, type Finding } from '../lib/discovery/index.ts'

/** The sources findings come from, each a key an engager's handle is named by. */
export const FINDING_SOURCES = ['hn', 'rss', 'bluesky', 'mastodon'] as const
const CHUNK = 80

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`stump-erasure\u0000${value}`))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
/** An author as erasure matches them: without a leading '@', compared without case. */
export const foldAuthor = (author: string) => author.trim().replace(/^@+/, '').toLowerCase()

/** One erased finding, as stored. */
export interface ErasedFinding { url_key: string; source: string; author_id: string | null }

/** The tombstones of one erasure: each finding's address, and each source handle or author id. */
export async function tombstoneStatements(erasureId: string, findings: ErasedFinding[], authors: Array<{ source: string; handle: string }>): Promise<D1Sql[]> {
  const keys = new Set(await Promise.all(findings.map(finding => digest(finding.url_key))))
  const named = [...authors, ...findings.filter(finding => finding.author_id).map(finding => ({ source: finding.source, handle: finding.author_id! }))]
  const pairs = new Map<string, { source: string; hash: string }>()
  for (const { source, handle } of named) {
    const hash = await digest(foldAuthor(handle))
    pairs.set(`${source}|${hash}`, { source, hash })
  }
  return [
    ...[...keys].map(hash => ({ sql: 'INSERT OR IGNORE INTO stump_erased_findings(key_hash,erasure_id) VALUES(?,?)', params: [hash, erasureId] })),
    ...[...pairs.values()].map(({ source, hash }) => ({ sql: 'INSERT OR IGNORE INTO stump_erased_authors(source,handle_hash,erasure_id) VALUES(?,?,?)', params: [source, hash, erasureId] })),
  ]
}

async function present(db: D1Database, table: 'stump_erased_findings' | 'stump_erased_authors', column: string, hashes: string[], source?: string): Promise<Set<string>> {
  const found = new Set<string>(), unique = [...new Set(hashes)]
  for (let index = 0; index < unique.length; index += CHUNK) {
    const chunk = unique.slice(index, index + CHUNK)
    const rows = (await db.prepare(`SELECT ${column} AS hash FROM ${table} WHERE ${source === undefined ? '' : 'source=? AND '}${column} IN (${chunk.map(() => '?').join(',')})`)
      .bind(...(source === undefined ? [] : [source]), ...chunk).all<{ hash: string }>()).results
    for (const row of rows) found.add(row.hash)
  }
  return found
}

/** The findings of a run that belong to an erased post or an erased author on their source. */
export async function erasedAmong(db: D1Database, findings: Finding[]): Promise<Set<Finding>> {
  if (!findings.length) return new Set()
  const marks = await Promise.all(findings.map(async finding => ({
    finding, key: await digest(canonicalUrl(finding.url)),
    authors: await Promise.all([finding.author, finding.author_id].filter((value): value is string => !!value && !!foldAuthor(value)).map(value => digest(foldAuthor(value)))),
  })))
  const keys = await present(db, 'stump_erased_findings', 'key_hash', marks.map(mark => mark.key))
  const erased = new Set(marks.filter(mark => keys.has(mark.key)).map(mark => mark.finding))
  for (const source of new Set(findings.map(finding => finding.source))) {
    const own = marks.filter(mark => mark.finding.source === source)
    const authors = await present(db, 'stump_erased_authors', 'handle_hash', own.flatMap(mark => mark.authors), source)
    for (const mark of own) if (mark.authors.some(hash => authors.has(hash))) erased.add(mark.finding)
  }
  return erased
}
