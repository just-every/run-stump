import { toEntry, type LedgerRow } from './entry.ts'

const COLUMNS = ['id', 'url', 'network', 'network_id', 'venue_id', 'account_id', 'person_id', 'agent_id', 'agent_name', 'by', 'text', 'disclosure_line', 'claims',
  'product_id', 'campaign', 'route', 'state', 'confirmation', 'revision', 'posted_at', 'charge_usd', 'approved_by', 'hold', 'removal', 'legal_hold', 'versions'] as const

/**
 * One CSV field. Numbers stay numbers. Text a spreadsheet would read as a
 * formula (starting with = + - @, a tab or a line break, or their full-width
 * forms) keeps its words and gains a leading apostrophe, the spreadsheet mark
 * for plain text, so every field opens as the words that were posted.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const formula = /^[=+\-@\t\r\n＝＋－＠]/.test(text)
  if (formula) text = `'${text}`
  return formula || /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The rows as CSV: one header line, then one line per entry with every field of the record. */
export function toCsv(rows: LedgerRow[], versions: (row: LedgerRow) => number): string {
  const lines = [COLUMNS.join(',')]
  for (const row of rows) {
    const entry = toEntry(row, [])
    const values: Record<typeof COLUMNS[number], unknown> = {
      ...entry, agent_id: entry.agent && (entry.agent as { id?: string }).id, agent_name: entry.agent && (entry.agent as { name?: string }).name, versions: versions(row),
    }
    lines.push(COLUMNS.map(column => cell(values[column])).join(','))
  }
  return `${lines.join('\n')}\n`
}
