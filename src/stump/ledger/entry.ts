// A ledger entry as the doors answer it (V1 "Records": Ledger entry). The rows are
// written by the publishing lane's recorder and changed only by corrections here.
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

/** The entry as first recorded, for an entry nobody has corrected. */
export function recordedVersion(row: LedgerRow): LedgerVersion {
  const agent = json(row.agent) as { id?: string } | null
  return { version: 1, text: (row.text as string | null) ?? null, note: 'As recorded', fields: {}, person_id: (row.person_id as string | null) ?? null, agent_id: agent?.id ?? null, at: iso(row.created_at) }
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
  versions: LedgerVersion[]
}

export function toEntry(row: LedgerRow, versions: LedgerVersion[]): LedgerEntry {
  return {
    id: row.id as string, url: row.url as string | null, network: row.network as string | null, network_id: row.network_id as string | null, venue_id: row.venue_id as string | null,
    venue_name: (row.venue_name as string | null | undefined) ?? null, account_id: row.account_id as string | null, person_id: row.person_id as string | null,
    agent: json(row.agent) as LedgerEntry['agent'], by: row.by_label as string, text: row.text as string | null, disclosure_line: row.disclosure_line as string | null,
    claims: json(row.claims) as unknown[], product_id: row.product_id as string | null, campaign: row.campaign as string | null, route: row.route as LedgerEntry['route'],
    state: row.state as LedgerEntry['state'], confirmation: row.confirmation as LedgerEntry['confirmation'], revision: row.revision as number | null, posted_at: iso(row.posted_at),
    charge_usd: row.charge_usd as number | null, approved_by: json(row.approved_by), hold: json(row.hold), removal: json(row.removal) as LedgerEntry['removal'],
    legal_hold: json(row.legal_hold) as LedgerEntry['legal_hold'], versions: versions.length ? versions : [recordedVersion(row)],
  }
}
