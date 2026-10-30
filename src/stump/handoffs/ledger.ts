// The ledger entry for a handed-off post (STUMP-LEDGER-001, STUMP-HANDOFF-002).
// The data contract makes src/stump/ledger/record.ts the one writer of
// stump_ledger; its writer today takes published items only, so this is the
// hand-off route's write in the shape that writer takes (route, confirmation,
// person, agent, the read-back url and text), to move into record.ts with it.

export interface HandedOff {
  handoff_id: string; item_id: string | null; venue_id: string; network: string; network_id: string | null; url: string
  person_id: string; person_name: string; agent: { id: string; name: string } | null; text: string | null; disclosure_line: string | null
  claims: string[]; product_id: string | null; campaign: string | null; confirmation: 'network' | 'person'; revision: number | null; posted_at: number
}

/** The statement that records one handed-off post, read as "<agent> for <person>" when an agent prepared or recorded it. */
export function recordHandedOff(db: D1Database, entry: HandedOff, id: string, now: number): D1PreparedStatement {
  const by = entry.agent ? `${entry.agent.name} for ${entry.person_name}` : entry.person_name
  return db.prepare(`INSERT INTO stump_ledger(id,item_id,handoff_id,url,network,network_id,venue_id,account_id,person_id,agent,by_label,text,disclosure_line,claims,product_id,campaign,
    route,state,confirmation,revision,posted_at,charge_usd,approved_by,hold,created_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,'handed_off','posted',?,?,?,NULL,NULL,NULL,?,?)`)
    .bind(id, entry.item_id, entry.handoff_id, entry.url, entry.network, entry.network_id, entry.venue_id, entry.person_id, entry.agent ? JSON.stringify(entry.agent) : null, by,
      entry.text, entry.disclosure_line, JSON.stringify(entry.claims), entry.product_id, entry.campaign, entry.confirmation, entry.revision, entry.posted_at, now, now)
}
