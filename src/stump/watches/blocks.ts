import type { HandleRef } from '../lib/discovery/index.ts'
import type { SourceKind } from './model.ts'

/** One entry of the company's author block list; `source` null blocks the handle on every source. */
export interface BlockedAuthor { handle: string; source: SourceKind | null }

interface Row { source: string; handle: string }

/** The company's block list (STUMP-WATCH-013.4), the same for every watch. */
export async function blockedAuthors(db: D1Database): Promise<BlockedAuthor[]> {
  const rows = (await db.prepare('SELECT source,handle FROM stump_blocked_authors ORDER BY handle,source').all<Row>()).results
  return rows.map(row => ({ handle: row.handle, source: row.source === '' ? null : row.source as SourceKind }))
}

/** The block list as the screening library reads it. */
export const blockRefs = (list: BlockedAuthor[]): HandleRef[] => list.map(item => item.source ? { source: item.source, handle: item.handle } : item.handle)

/** The source keys a block on `source` (or on every source) covers, as a SQL condition on stump_watch_sources.source_key. */
export function sourceKeyCondition(source: SourceKind | null): { sql: string; binds: string[] } {
  if (source === null) return { sql: '1=1', binds: [] }
  if (source === 'hn' || source === 'bluesky') return { sql: 'source_key=?', binds: [source] }
  return { sql: 'source_key LIKE ?', binds: [`${source}:%`] }
}
