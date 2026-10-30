// A ledger entry as the doors answer it (V1 "Records": Ledger entry). The rows are
// written by the publishing lane's recorder and changed only by corrections here.
// A version row is either the recorder's record of an earlier state (written before an
// outcome changes the entry), a snapshot of the entry as it stood before a correction, or
// a correction. The entry itself is always the current state, so the versions answered end
// with it: when the last stored row does not hold the entry's current state, the current
// state is the last version.
export interface LedgerRow { [key: string]: unknown }

export interface LedgerVersion {
  version: number
  text: string | null
  note: string | null
  fields: Record<string, unknown>
  person_id: string | null
  agent_id: string | null
  at: string | null
}

const json = (value: unknown) => typeof value === 'string' ? JSON.parse(value) as unknown : value ?? null
const iso = (value: unknown) => typeof value === 'number' ? new Date(value).toISOString() : null

/** The fields a correction may change; each is recorded on the version it makes. */
export const CORRECTABLE = ['text', 'url', 'network_id', 'campaign', 'product_id', 'disclosure_line'] as const
export type Correctable = typeof CORRECTABLE[number]

export function toVersion(row: LedgerRow, number: number): LedgerVersion {
  return { version: number, text: (row.text as string | null) ?? null, note: (row.note as string | null) ?? null, fields: (json(row.fields) ?? {}) as Record<string, unknown>,
    person_id: (row.person_id as string | null) ?? null, agent_id: (row.agent_id as string | null) ?? null, at: iso(row.at) }
}

/** The entry fields a version is compared on: what a correction may change, and the outcome state. */
const STATE = [...CORRECTABLE, 'state'] as const
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)

/** The entry's current text, correctable fields and state, as a snapshot version stores them. */
export function stateFields(row: LedgerRow): Record<string, unknown> {
  return Object.fromEntries(STATE.map(field => [field, row[field] ?? null]))
}

/** Whether a version holds the entry's current state: its text and every compared field it names match the entry. */
export function holdsCurrent(version: LedgerVersion, row: LedgerRow): boolean {
  return same(version.text, row.text) && STATE.every(field => !(field in version.fields) || same(version.fields[field], row[field]))
}

/** When the entry's current state becomes a version: at creation for a first version, otherwise at its last change (never before an earlier version). */
export function currentAt(row: LedgerRow, versions: LedgerVersion[]): number {
  const last = versions.length ? Date.parse(versions[versions.length - 1].at ?? '') : NaN
  if (!versions.length) return Number(row.created_at)
  return Math.max(Number(row.updated_at ?? row.created_at), Number.isFinite(last) ? last : 0)
}

/** The entry's current state as a version, numbered after the stored ones. */
export function currentVersion(row: LedgerRow, versions: LedgerVersion[]): LedgerVersion {
  const agent = json(row.agent) as { id?: string } | null
  return { version: versions.length + 1, text: (row.text as string | null) ?? null, note: 'As recorded', fields: stateFields(row), person_id: (row.person_id as string | null) ?? null,
    agent_id: agent?.id ?? null, at: iso(currentAt(row, versions)) }
}

/** The stored versions, ending with the entry's current state. */
export function withCurrent(row: LedgerRow, versions: LedgerVersion[]): LedgerVersion[] {
  const last = versions[versions.length - 1]
  return last && holdsCurrent(last, row) ? versions : [...versions, currentVersion(row, versions)]
}

/** A ledger entry (V1 "Records": Ledger entry), with the venue's name and the removal and hold facts. */
export interface LedgerEntry {
  id: string
  url: string | null
  network: string | null
  network_id: string | null
  venue_id: string | null
  venue_name: string | null
  account_id: string | null
  person_id: string | null
  agent: { id: string; name: string } | null
  /** "<agent> for <person>" for an agent's work, the person's name otherwise. */
  by: string
  text: string | null
  disclosure_line: string | null
  claims: unknown[]
  product_id: string | null
  campaign: string | null
  route: 'published' | 'handed_off' | 'orbit' | 'mango'
  state: 'posted' | 'failed' | 'uncertain' | 'deleted' | 'removed'
  confirmation: 'network' | 'person' | null
  revision: number | null
  posted_at: string | null
  charge_usd: number | null
  approved_by: unknown
  hold: unknown
  removal: { reason: string; person_id: string; agent_id: string | null; at: string } | null
  legal_hold: { reason: string; person_id: string; agent_id: string | null; at: string } | null
  /** Results the entry arrived with from the tool it was imported from: {source, values, read_at}. */
  results: { source: string; values: Record<string, number>; read_at: string | null } | null
  versions: LedgerVersion[]
}

function importedResults(value: unknown): LedgerEntry['results'] {
  const results = json(value) as { source: string; values: Record<string, number>; read_at: number | null } | null
  return results ? { source: results.source, values: results.values, read_at: iso(results.read_at) } : null
}

export function toEntry(row: LedgerRow, versions: LedgerVersion[]): LedgerEntry {
  return {
    id: row.id as string, url: row.url as string | null, network: row.network as string | null, network_id: row.network_id as string | null, venue_id: row.venue_id as string | null,
    venue_name: (row.venue_name as string | null | undefined) ?? null, account_id: row.account_id as string | null, person_id: row.person_id as string | null,
    agent: json(row.agent) as LedgerEntry['agent'], by: row.by_label as string, text: row.text as string | null, disclosure_line: row.disclosure_line as string | null,
    claims: json(row.claims) as unknown[], product_id: row.product_id as string | null, campaign: row.campaign as string | null, route: row.route as LedgerEntry['route'],
    state: row.state as LedgerEntry['state'], confirmation: row.confirmation as LedgerEntry['confirmation'], revision: row.revision as number | null, posted_at: iso(row.posted_at),
    charge_usd: row.charge_usd as number | null, approved_by: json(row.approved_by), hold: json(row.hold), removal: json(row.removal) as LedgerEntry['removal'],
    legal_hold: json(row.legal_hold) as LedgerEntry['legal_hold'], results: importedResults(row.results), versions: withCurrent(row, versions),
  }
}
