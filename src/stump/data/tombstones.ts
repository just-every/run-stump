// What an erasure leaves behind so the erased person stays erased (STUMP-DATA-002):
// a digest of each erased finding's canonical address and of the person's handle
// (and author id) on each source findings come from and on X, where the inbox reads.
// A poll drops a finding whose address or author is among them before it is stored,
// and the inbox stores no post of theirs as a thread's context, so no later poll,
// overlap window or backfill brings the person back or alerts with their post.
// Only digests are kept, never the address or the handle. Each digest is keyed by
// this installation's own erasure key, so a digest says nothing to someone who
// guesses a handle without the key; the key travels in the archive with the
// digests, so a restore keeps the erasure in force.
import type { D1Sql } from '../../modules/import-kit/src/d1/index.ts'
import { canonicalUrl, type Finding } from '../lib/discovery/index.ts'

/** The sources findings come from, each a key an engager's handle is named by. */
export const FINDING_SOURCES = ['hn', 'rss', 'bluesky', 'mastodon'] as const
/** Where an erased author is kept out: the finding sources, and X, whose inbox reads a thread's earlier posts. */
export const TOMBSTONE_SOURCES = [...FINDING_SOURCES, 'x'] as const
const CHUNK = 80
const PREFIX = 'stump-erasure\u0000'

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
const fromHex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], pair => parseInt(pair, 16))

/** The installation's erasure key: made by the first erasure, and only read by polls. */
async function erasureKey(db: D1Database, make: boolean): Promise<CryptoKey | null> {
  if (make) {
    const fresh = hex(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer)
    await db.prepare('INSERT OR IGNORE INTO stump_erasure_key(id,key,created_at) VALUES(1,?,?)').bind(fresh, Date.now()).run()
  }
  const row = await db.prepare('SELECT key FROM stump_erasure_key WHERE id=1').first<{ key: string }>()
  return row ? crypto.subtle.importKey('raw', fromHex(row.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) : null
}

const keyed = async (key: CryptoKey, value: string) => hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(PREFIX + value)))
/** How erasures made before the installation had a key wrote their digests; still matched, so those erasures stay in force. */
const unkeyed = async (value: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PREFIX + value)))
/** Every digest a stored tombstone of this value can have. */
const forms = async (key: CryptoKey | null, value: string) => [...key ? [await keyed(key, value)] : [], await unkeyed(value)]

/** An author as erasure matches them: without a leading '@', compared without case. */
export const foldAuthor = (author: string) => author.trim().replace(/^@+/, '').toLowerCase()

/** One erased finding, as stored. */
export interface ErasedFinding { url_key: string; source: string; author_id: string | null }

/** The tombstones of one erasure: each finding's address, and each source handle or author id. */
export async function tombstoneStatements(db: D1Database, erasureId: string, findings: ErasedFinding[], authors: Array<{ source: string; handle: string }>): Promise<D1Sql[]> {
  if (!findings.length && !authors.length) return []
  const key = (await erasureKey(db, true))!
  const keys = new Set(await Promise.all(findings.map(finding => keyed(key, finding.url_key))))
  const named = [...authors, ...findings.filter(finding => finding.author_id).map(finding => ({ source: finding.source, handle: finding.author_id! }))]
  const pairs = new Map<string, { source: string; hash: string }>()
  for (const { source, handle } of named) {
    if (!foldAuthor(handle)) continue
    const hash = await keyed(key, foldAuthor(handle))
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

/** The authors among these (handles or author ids) that an erasure keeps out on this source. */
export async function erasedAuthors(db: D1Database, source: string, authors: Array<string | null | undefined>): Promise<Set<string>> {
  const named = [...new Set(authors.filter((value): value is string => !!value && !!foldAuthor(value)))]
  if (!named.length) return new Set()
  const key = await erasureKey(db, false)
  const marks = await Promise.all(named.map(async author => ({ author, hashes: await forms(key, foldAuthor(author)) })))
  const found = await present(db, 'stump_erased_authors', 'handle_hash', marks.flatMap(mark => mark.hashes), source)
  return new Set(marks.filter(mark => mark.hashes.some(hash => found.has(hash))).map(mark => mark.author))
}

/** The findings of a run that belong to an erased post or an erased author on their source. */
export async function erasedAmong(db: D1Database, findings: Finding[]): Promise<Set<Finding>> {
  if (!findings.length) return new Set()
  const key = await erasureKey(db, false)
  const marks = await Promise.all(findings.map(async finding => ({ finding, keys: await forms(key, canonicalUrl(finding.url)) })))
  const keys = await present(db, 'stump_erased_findings', 'key_hash', marks.flatMap(mark => mark.keys))
  const erased = new Set(marks.filter(mark => mark.keys.some(hash => keys.has(hash))).map(mark => mark.finding))
  for (const source of new Set(findings.map(finding => finding.source))) {
    const own = findings.filter(finding => finding.source === source)
    const authors = await erasedAuthors(db, source, own.flatMap(finding => [finding.author, finding.author_id]))
    for (const finding of own) if ([finding.author, finding.author_id].some(value => !!value && authors.has(value))) erased.add(finding)
  }
  return erased
}
