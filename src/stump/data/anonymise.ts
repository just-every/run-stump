// A journalist's name taken out of the company's own writing (STUMP-DATA-002.1):
// a pitch keeps its words with every form of the name replaced, in any case,
// the whole name and each part of it, in its text, subject, thread parts, the
// options it was drafted with (a prompt names the person), and every revision.
import type { D1Sql } from '../../modules/import-kit/src/d1/index.ts'

export const ERASED_NAME = '[name erased]'
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Short words that join a name and say nothing about who it is. */
const JOINERS = new Set(['de', 'da', 'di', 'do', 'du', 'del', 'della', 'der', 'den', 'des', 'van', 'von', 'la', 'le', 'el', 'al', 'bin', 'ben', 'st', 'jr', 'sr', 'mr', 'mrs', 'ms', 'dr'])

/**
 * Every form of a person's name: the whole name with any spacing or joined up,
 * then each of its parts of two letters or more, matched as whole words in any case.
 */
export function nameMatcher(name: string): RegExp {
  const forms = [wholeName(name), ...nameParts(name).sort((a, b) => b.length - a.length).map(escape)]
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.join('|')})(?![\\p{L}\\p{N}])`, 'giu')
}

// The whole name also as one word or a slug ('jordanreed', 'jordan-reed', 'jordan.reed'), as addresses and keys write it.
const wholeName = (name: string) => name.trim().split(/\s+/).filter(Boolean).map(escape).join('[\\s._-]*')

/** The whole name alone, in any of those forms and any case: what says a record is about this person. */
export const fullNameMatcher = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${wholeName(name)}(?![\\p{L}\\p{N}])`, 'iu')

/** The parts of a name that say who it is: each word, and each half of a hyphenated one, of two letters or more. */
export function nameParts(name: string): string[] {
  const parts = new Set<string>()
  for (const word of name.trim().split(/\s+/).filter(Boolean)) for (const part of [word, ...word.split(/[-‐]/)]) {
    const bare = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if ([...bare].filter(char => /\p{L}/u.test(char)).length >= 2 && !JOINERS.has(bare.toLowerCase())) parts.add(bare)
  }
  return [...parts]
}

export const withoutName = (text: string, name: RegExp) => text.replace(name, ERASED_NAME)

/** Every string inside a JSON value, with the name taken out. */
export function jsonWithoutName(value: unknown, name: RegExp): unknown {
  if (typeof value === 'string') return withoutName(value, name)
  if (Array.isArray(value)) return value.map(item => jsonWithoutName(item, name))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonWithoutName(item, name)]))
  return value
}
const jsonColumn = (text: string | null, name: RegExp) => text === null ? null : JSON.stringify(jsonWithoutName(JSON.parse(text) as unknown, name))

/**
 * The statements that take the name out of each pitch and every revision, and
 * set the anonymised reference in place of the contact, read from the rows as
 * they stand now.
 */
export async function pitchStatements(db: D1Database, items: string[], name: RegExp, reference: Record<string, unknown>): Promise<D1Sql[]> {
  if (!items.length) return []
  const marks = items.map(() => '?').join(',')
  const rows = (await db.prepare(`SELECT id,text,subject,parts,options,ai,recipient FROM stump_items WHERE id IN (${marks})`).bind(...items)
    .all<{ id: string; text: string | null; subject: string | null; parts: string | null; options: string; ai: string | null; recipient: string | null }>()).results
  const revisions = (await db.prepare(`SELECT item_id,revision,text,parts FROM stump_item_revisions WHERE item_id IN (${marks})`).bind(...items)
    .all<{ item_id: string; revision: number; text: string | null; parts: string | null }>()).results
  return [
    ...rows.map(row => ({
      sql: 'UPDATE stump_items SET text=?,subject=?,parts=?,options=?,ai=?,recipient=? WHERE id=?',
      params: [row.text === null ? null : withoutName(row.text, name), row.subject === null ? null : withoutName(row.subject, name), jsonColumn(row.parts, name),
        jsonColumn(row.options, name), jsonColumn(row.ai, name), row.recipient === null ? null : JSON.stringify({ ...JSON.parse(row.recipient) as Record<string, unknown>, ...reference }), row.id],
    })),
    ...revisions.map(row => ({
      sql: 'UPDATE stump_item_revisions SET text=?,parts=? WHERE item_id=? AND revision=?',
      params: [row.text === null ? null : withoutName(row.text, name), jsonColumn(row.parts, name), row.item_id, row.revision],
    })),
  ]
}
