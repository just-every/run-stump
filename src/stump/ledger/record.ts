// The one writer of the ledger (STUMP-LEDGER-001): every posted, failed and
// uncertain publish outcome, with "<agent> for <person>", the text read back
// from the network, the revision that went out and its charge. An item has one
// published entry per account; a later outcome for it keeps the earlier one as
// a version, so nothing on the record is lost (append-only).

export interface LedgerItem {
  id: string; network: string | null; account_id: string | null; person_id: string; venue_id: string | null; product_id: string | null; campaign: string | null
  claims_used: string; revision: number; text: string | null; parts: string | null; agent: string | null; scheduled_by: string | null; approved_by: string | null
}

export type LedgerOutcome =
  | { state: 'posted'; url: string; network_id: string; text: string; posted_at: number }
  | { state: 'failed' | 'uncertain'; url: string | null; network_id: string | null; error: { code: string; message: string }; hold?: { owner_id: string; reason: string } | null }

type Agent = { id: string; name: string }
const parse = <T>(value: string | null): T | null => value ? JSON.parse(value) as T : null

/** The agent behind an outcome: the one that published it, else the one that drafted it. */
function agentOf(item: LedgerItem): Agent | null {
  return parse<{ agent?: Agent | null }>(item.scheduled_by)?.agent ?? parse<Agent>(item.agent)
}

const attempted = (item: LedgerItem) => item.parts ? (JSON.parse(item.parts) as string[]).join('\n\n') : item.text

export async function recordOutcome(db: D1Database, item: LedgerItem, outcome: LedgerOutcome, now: number): Promise<D1PreparedStatement[]> {
  const person = await db.prepare('SELECT display_name FROM stump_people WHERE id=?').bind(item.person_id).first<{ display_name: string }>()
  const name = person?.display_name ?? item.person_id, agent = agentOf(item)
  const by = agent ? `${agent.name} for ${name}` : name
  const scheduled = parse<{ approved_by?: Array<{ id: string; name: string }> }>(item.scheduled_by)
  const approved = scheduled?.approved_by?.length ? JSON.stringify(scheduled.approved_by) : item.approved_by
  // X charges each post from the company's price table; the entry carries what this item's posts cost.
  const charge = item.network === 'x'
    ? ((await db.prepare("SELECT COALESCE(SUM(usd_micro),0) AS micro FROM stump_network_calls WHERE item_id=? AND account_id=? AND act IN ('post','post_with_url')")
      .bind(item.id, item.account_id).first<{ micro: number }>())?.micro ?? 0) / 1e6
    : null
  const fields = outcome.state === 'posted'
    ? { url: outcome.url, network_id: outcome.network_id, text: outcome.text, posted_at: outcome.posted_at, confirmation: 'network', hold: null }
    : { url: outcome.url, network_id: outcome.network_id, text: attempted(item), posted_at: null, confirmation: null,
      hold: outcome.state === 'uncertain' && outcome.hold ? JSON.stringify({ ...outcome.hold, error: outcome.error }) : JSON.stringify({ error: outcome.error }) }
  const existing = await db.prepare("SELECT * FROM stump_ledger WHERE item_id=? AND account_id=? AND route='published'").bind(item.id, item.account_id).first<Record<string, unknown>>()
  if (!existing) {
    return [db.prepare(`INSERT INTO stump_ledger(id,item_id,url,network,network_id,venue_id,account_id,person_id,agent,by_label,text,claims,product_id,campaign,route,state,
      confirmation,revision,posted_at,charge_usd,approved_by,hold,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), item.id, fields.url, item.network, fields.network_id, item.venue_id, item.account_id, item.person_id, agent ? JSON.stringify(agent) : null, by,
        fields.text, item.claims_used, item.product_id, item.campaign, outcome.state, fields.confirmation, item.revision, fields.posted_at, charge, approved, fields.hold, now, now)]
  }
  const previous = { state: existing.state, url: existing.url, network_id: existing.network_id, text: existing.text, revision: existing.revision, posted_at: existing.posted_at,
    charge_usd: existing.charge_usd, hold: parse(existing.hold as string | null), by: existing.by_label }
  return [
    db.prepare('INSERT INTO stump_ledger_versions(id,entry_id,text,note,fields,person_id,agent_id,at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), existing.id, existing.text, `outcome ${String(existing.state)} then ${outcome.state}`, JSON.stringify(previous), item.person_id, agent?.id ?? null, now),
    db.prepare(`UPDATE stump_ledger SET url=?,network_id=?,agent=?,by_label=?,text=?,state=?,confirmation=?,revision=?,posted_at=?,charge_usd=?,approved_by=?,hold=?,updated_at=? WHERE id=?`)
      .bind(fields.url, fields.network_id, agent ? JSON.stringify(agent) : null, by, fields.text, outcome.state, fields.confirmation, item.revision, fields.posted_at, charge, approved, fields.hold, now, existing.id),
  ]
}
