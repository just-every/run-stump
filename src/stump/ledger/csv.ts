import { toEntry, type LedgerRow } from './entry.ts'

const COLUMNS = ['id', 'url', 'network', 'network_id', 'venue_id', 'account_id', 'person_id', 'agent_id', 'agent_name', 'by', 'text', 'disclosure_line', 'claims',
  'product_id', 'campaign', 'route', 'state', 'confirmation', 'revision', 'posted_at', 'charge_usd', 'approved_by', 'hold', 'removal', 'legal_hold', 'versions'] as const

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
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
